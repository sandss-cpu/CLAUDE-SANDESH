#!/bin/bash
# Identity, sessions and data protection (Phase 3, Feature 7), against a running API:
# the password policy, lockout after repeated failures (per account and per address),
# "sign out everywhere", an authenticator chosen by a traveller with one-time recovery
# codes, new-device records, the account export and a re-authenticated deletion, and
# encrypted columns that a raw database dump cannot read.
#
# The traveller test account is put back as it was (no authenticator, no lock); the
# throwaway account it registers is deleted by the test itself.
#
#   bash scripts/security_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: security_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

PG_DUMP=${PG_DUMP:-"$(dirname "$PSQL")/pg_dump"}
STAMP=$(date +%s)
T_EMAIL=traveller@bato.test
T_ID=$(sql "select id from users where email='$T_EMAIL'")
NEW_EMAIL="smoke-$STAMP@example.com"
UA_PHONE='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
UA_NEW='Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
START=$(date -u +"%Y-%m-%d %H:%M:%S")
ua_call(){ # user-agent method path token [json]
  local ua=$1; shift
  local args=(-s -o "$R" -w "%{http_code}" -X "$1" "$API$2" -H 'Content-Type: application/json' -A "$ua")
  [ -n "$3" ] && args+=(-H "Authorization: Bearer $3")
  [ -n "$4" ] && args+=(-d "$4")
  curl "${args[@]}"
}
reset_traveller(){
  sql "update users set \"totpSecret\"=null, \"totpConfirmedAt\"=null, \"sessionsValidFrom\"=null where id='$T_ID';
       delete from recovery_codes where \"userId\"='$T_ID';
       delete from login_guards where key='acct:$T_ID' or key like 'ip:%' or key like 'acct:none:%';" >/dev/null
}
cleanup(){ reset_traveller; sql "delete from users where email='$NEW_EMAIL'" >/dev/null; }
trap cleanup EXIT
reset_traveller
T_PW=$(pw "$T_EMAIL")

echo "== passwords"
B="{\"name\":\"Smoke Tester\",\"email\":\"$NEW_EMAIL\",\"password\":\"short-pw\"}"
ok "fewer than 10 characters: refused" 400 "$(call POST /auth/email/register "" "$B")"
B="{\"name\":\"Smoke Tester\",\"email\":\"$NEW_EMAIL\",\"password\":\"password2024!\"}"
ok "a common password with digits added: refused" 400 "$(call POST /auth/email/register "" "$B")"
ok "with a reason a person can act on" true "$(get "'common' in d['message']")"
B="{\"name\":\"Smoke Tester\",\"email\":\"$NEW_EMAIL\",\"password\":\"smoketester-$STAMP\"}"
ok "one containing the person's name: refused" 400 "$(call POST /auth/email/register "" "$B")"
NEW_PW="river lantern $STAMP"
B="{\"name\":\"Smoke Tester\",\"email\":\"$NEW_EMAIL\",\"password\":\"$NEW_PW\"}"
ok "a long passphrase: accepted" 201 "$(call POST /auth/email/register "" "$B")"
VERIFY=$(get "data['devLink'].split('verify=')[1]")
B="{\"token\":\"$VERIFY\"}"
ok "the emailed link confirms it and signs in" 201 "$(ua_call "$UA_PHONE" POST /auth/email/verify "" "$B")"
NEW=$(get "data['accessToken']")

echo "== lockout after repeated failures"
B="{\"email\":\"$T_EMAIL\",\"password\":\"wrong-password-$STAMP\"}"
for i in 1 2 3; do call POST /auth/email/login "" "$B" >/dev/null; done
ok "the fourth wrong password is still just wrong" 401 "$(call POST /auth/email/login "" "$B")"
ok "the fifth starts a wait" 401 "$(call POST /auth/email/login "" "$B")"
B2="{\"email\":\"$T_EMAIL\",\"password\":\"$T_PW\"}"
ok "during the wait even the right password is refused" 429 "$(call POST /auth/email/login "" "$B2")"
ok "with a code and how long to wait" "SIGN_IN_LOCKED true" "$(get "d['code'] + ' ' + str(d['message'].startswith('Too many failed attempts')).lower()")"
ok "each failure is in the audit log" true "$(sql "select count(*) >= 5 from audit_events where action='auth.failed' and \"entityId\"='$T_ID' and \"createdAt\" >= '$START'" | sed 's/t/true/;s/^f$/false/')"
sql "delete from login_guards where key='acct:$T_ID'" >/dev/null
ok "after the wait the right password works" 201 "$(call POST /auth/email/login "" "$B2")"
ok "and success clears the count" 0 "$(sql "select count(*) from login_guards where key='acct:$T_ID'")"
# Spraying many accounts from one address: each account gets its own few tries, the address does not.
sql "delete from login_guards where key like 'ip:%'" >/dev/null
for i in $(seq 1 29); do B="{\"email\":\"nobody-$STAMP-$i@example.com\",\"password\":\"wrong-password\"}"; call POST /auth/email/login "" "$B" >/dev/null; done
B="{\"email\":\"nobody-$STAMP-30@example.com\",\"password\":\"wrong-password\"}"
ok "thirty failures from one address, across accounts, lock the address" 401 "$(call POST /auth/email/login "" "$B")"
ok "for every account tried from it" 429 "$(call POST /auth/email/login "" "$B2")"
ok "the lock is audited" 1 "$(sql "select least(count(*), 1) from audit_events where action='auth.locked' and \"createdAt\" >= '$START'")"
sql "delete from login_guards where key like 'ip:%' or key like 'acct:none:%'" >/dev/null

echo "== sign out everywhere"
TRAV=$(ua_call "$UA_PHONE" POST /auth/email/login "" "$B2" >/dev/null; get "data['accessToken']")
REFRESH=$(get "data['refreshToken']")
ok "a session works" 200 "$(call GET /users/me "$TRAV")"
sleep 1
ok "sign out everywhere" 201 "$(call POST /auth/logout-all "$TRAV")"
ok "the access token stops working at once" 401 "$(call GET /users/me "$TRAV")"
B="{\"refreshToken\":\"$REFRESH\"}"
ok "and cannot be refreshed" 401 "$(call POST /auth/refresh "" "$B")"
ok "audited" 1 "$(sql "select count(*) from audit_events where action='auth.logout_all' and \"entityId\"='$T_ID' and \"createdAt\" >= '$START'")"
sleep 1
TRAV=$(ua_call "$UA_PHONE" POST /auth/email/login "" "$B2" >/dev/null; get "data['accessToken']")
ok "signing in again works" 200 "$(call GET /users/me "$TRAV")"

echo "== an authenticator the traveller chose, with recovery codes"
ok "set one up" 201 "$(call POST /auth/mfa/setup "$TRAV")"
SECRET=$(get "data['secret']")
ok "stored encrypted" true "$(sql "select \"totpSecret\" like 'enc:%' from users where id='$T_ID'" | sed 's/^t$/true/;s/^f$/false/')"
B="{\"code\":\"$(totp "$SECRET")\"}"
ok "confirm it" 201 "$(call POST /auth/mfa/setup/confirm "$TRAV" "$B")"
ok "ten recovery codes, shown once" 10 "$(get "len(data['recoveryCodes'])")"
CODE1=$(get "data['recoveryCodes'][0]")
CODE2=$(get "data['recoveryCodes'][1]")
CODE_OLD=$(get "data['recoveryCodes'][2]")
ok "only hashes are kept" 0 "$(sql "select count(*) from recovery_codes where \"codeHash\" like '%$(echo "$CODE1" | tr -d '-')%'")"
ok "now sign-in asks for it" true "$(call POST /auth/email/login "" "$B2" >/dev/null; get "data['mfaRequired']")"
CH=$(get "data['challengeToken']")
B="{\"challengeToken\":\"$CH\",\"code\":\"$CODE1\"}"
ok "a recovery code signs in instead" 201 "$(call POST /auth/mfa/recover "" "$B")"
ok "and says how many are left" 9 "$(get "data['recoveryCodesLeft']")"
call POST /auth/email/login "" "$B2" >/dev/null; CH=$(get "data['challengeToken']")
B="{\"challengeToken\":\"$CH\",\"code\":\"$CODE1\"}"
ok "the same code cannot be used twice" 401 "$(call POST /auth/mfa/recover "" "$B")"
B="{\"challengeToken\":\"$CH\",\"code\":\"$CODE2\"}"
call POST /auth/mfa/recover "" "$B" >/dev/null; TRAV=$(get "data['accessToken']")
ok "a wrong authenticator code cannot make new ones" 400 "$(call POST /auth/mfa/recovery-codes "$TRAV" '{"code":"000000"}')"
sleep 1
B="{\"code\":\"$(totp "$SECRET")\"}"
ok "a current code makes a fresh set" 10 "$(call POST /auth/mfa/recovery-codes "$TRAV" "$B" >/dev/null; get "len(data['recoveryCodes'])")"
call POST /auth/email/login "" "$B2" >/dev/null; CH=$(get "data['challengeToken']")
B="{\"challengeToken\":\"$CH\",\"code\":\"$CODE_OLD\"}"
ok "and the old ones stop working" 401 "$(call POST /auth/mfa/recover "" "$B")"
reset_traveller

echo "== new devices"
DEVICES=$(sql "select count(*) from known_devices where \"userId\"='$T_ID'")
ua_call "$UA_PHONE" POST /auth/email/login "" "$B2" >/dev/null
ok "a browser already seen is just remembered" "$DEVICES" "$(sql "select count(*) from known_devices where \"userId\"='$T_ID'")"
ua_call "$UA_NEW" POST /auth/email/login "" "$B2" >/dev/null
NEWDEV=$(sql "select count(*) from audit_events where action='auth.new_device' and \"entityId\"='$T_ID' and \"createdAt\" >= '$START'")
ok "a new one is recorded and reported" 1 "$([ "$NEWDEV" -ge 1 ] && echo 1 || echo 0)"
ok "by family, never the raw user agent" true "$(sql "select bool_and(label not like '%Gecko%' and length(\"deviceHash\") = 64) from known_devices where \"userId\"='$T_ID'" | sed 's/^t$/true/;s/^f$/false/')"
sql "delete from known_devices where \"userId\"='$T_ID' and label='Firefox on Linux'" >/dev/null

echo "== the traveller's own data"
CODE=$(curl -s -o "$R" -w "%{http_code} %{content_type}" "$API/users/me/export" -H "Authorization: Bearer $NEW")
ok "export: a JSON file" "200 application/json; charset=utf-8" "$CODE"
ok "with their account in it" "$NEW_EMAIL" "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['account']['email'])" "$R")"
ok "and no secrets" 0 "$(grep -c 'passwordHash\|totpSecret\|refreshToken\|codeHash' "$R")"
ok "audited" 1 "$(sql "select count(*) from audit_events where action='account.export' and \"createdAt\" >= '$START'")"
ok "deleting needs the password again" 400 "$(call DELETE /users/me "$NEW" '{}')"
ok "the right one" 400 "$(call DELETE /users/me "$NEW" '{"password":"not the password"}')"
B="{\"password\":\"$NEW_PW\"}"
ok "with it, the account is deleted" 200 "$(call DELETE /users/me "$NEW" "$B")"
ok "gone from the database" 0 "$(sql "select count(*) from users where email='$NEW_EMAIL'")"
B="{\"email\":\"$NEW_EMAIL\",\"password\":\"$NEW_PW\"}"
ok "and cannot sign in" 401 "$(call POST /auth/email/login "" "$B")"
ADMIN=$(staff_login tester.admin@bato.test)
ok "staff accounts are closed by an administrator, not themselves" 403 "$(call DELETE /users/me "$ADMIN" '{}')"
sql "delete from login_guards where key like 'acct:none:%'" >/dev/null

echo "== verification documents (private, owners and staff only)"
TMP=$(mktemp -d)
node -e '
const sharp = require("sharp"); const fs = require("fs"); const dir = process.argv[1];
sharp({ create: { width: 1200, height: 800, channels: 3, background: "#ddccbb" } }).jpeg()
  .withExif({ IFD0: { Make: "SmokePhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "27/1 42/1 0/1" } })
  .toFile(dir + "/pan.jpg").then(() => {
    fs.writeFileSync(dir + "/reg.pdf", "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
    fs.writeFileSync(dir + "/bad.pdf", "%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n");
    fs.writeFileSync(dir + "/fake.jpg", "not really a picture at all, just text");
  });' "$TMP"
upload(){ # path token file kind -> status, body in $R
  curl -s -o "$R" -w "%{http_code}" -X POST "$API$1" -H "Authorization: Bearer $2" -F "file=@$3" -F "kind=$4"
}
OWNER=$(login owner.fleet@bato.test)
MANAGER=$(login manager.fleet@bato.test)
SINGLE=$(login owner.single@bato.test)
CID=$(sql "select id from operators where slug like 'himalayan%' limit 1")
ok "the owner uploads a photo of the PAN certificate" 201 "$(upload "/fleet/companies/$CID/documents" "$OWNER" "$TMP/pan.jpg" PAN)"
DOC1=$(get "data['id']")
ok "kept as a fresh WebP" image/webp "$(get "data['mimeType']")"
ok "and a PDF of the registration" 201 "$(upload "/fleet/companies/$CID/documents" "$OWNER" "$TMP/reg.pdf" COMPANY_REGISTRATION)"
DOC2=$(get "data['id']")
ok "a PDF that runs script is refused" 400 "$(upload "/fleet/companies/$CID/documents" "$OWNER" "$TMP/bad.pdf" OTHER)"
ok "so is text pretending to be a photo" 400 "$(upload "/fleet/companies/$CID/documents" "$OWNER" "$TMP/fake.jpg" OTHER)"
ok "an unknown kind is refused" 400 "$(upload "/fleet/companies/$CID/documents" "$OWNER" "$TMP/pan.jpg" PASSPORT)"
ok "a manager cannot see them (owners only)" 403 "$(call GET "/fleet/companies/$CID/documents" "$MANAGER")"
ok "another company: not found" 404 "$(call GET "/fleet/companies/$CID/documents" "$SINGLE")"
ok "nor upload to it" 404 "$(upload "/fleet/companies/$CID/documents" "$SINGLE" "$TMP/pan.jpg" PAN)"
ok "the owner lists both" 2 "$(call GET "/fleet/companies/$CID/documents" "$OWNER" >/dev/null; get "len([d for d in data if d['id'] in ('$DOC1','$DOC2')])")"
ok "not under the public uploads" 0 "$(ls uploads 2>/dev/null | grep -c "$(sql "select split_part(\"storageKey\", '/', 3) from verification_documents where id='$DOC1'")")"
ok "a short-lived link for the owner" 200 "$(call GET "/fleet/companies/$CID/documents/$DOC1/link" "$OWNER")"
LINK=$(get "data['url']")
curl -s -o "$TMP/got.webp" "$LINK"
ok "the photo behind it has no camera or location data" 0 "$(grep -c 'SmokePhone' "$TMP/got.webp")"
ok "a tampered link is refused (not found)" 404 "$(curl -s -o /dev/null -w "%{http_code}" "${LINK%?}0")"
ADMIN=$(staff_login tester.admin@bato.test)
ok "an admin lists them while verifying" 2 "$(call GET "/admin/verification-documents?operatorId=$CID" "$ADMIN" >/dev/null; get "len([d for d in data if d['id'] in ('$DOC1','$DOC2')])")"
ok "and opens one" 200 "$(call GET "/admin/verification-documents/$DOC2/link" "$ADMIN")"
PDFLINK=$(get "data['url']")
ok "a PDF is downloaded, never opened in the page" true "$(curl -s -D - -o /dev/null "$PDFLINK" | grep -ci 'content-disposition: attachment' | sed 's/^1$/true/')"
ok "staff looks are audited" 1 "$(sql "select count(*) from audit_events where action='verification.view' and \"entityId\"='$DOC2'")"
ok "a traveller cannot use the admin route" 403 "$(call GET "/admin/verification-documents?operatorId=$CID" "$(login traveller@bato.test)")"
ok "the owner deletes them" 200 "$(call DELETE "/fleet/companies/$CID/documents/$DOC1" "$OWNER")"
call DELETE "/fleet/companies/$CID/documents/$DOC2" "$OWNER" >/dev/null
ok "gone, file and row" 0 "$(sql "select count(*) from verification_documents where id in ('$DOC1','$DOC2')")"
B="{\"email\":\"business-owner@demo.bato.travel\",\"password\":\"$(grep -o "BatoDemo#[0-9]*" "$SMOKE_DIR/../prisma/seed.ts" | head -1)\"}"
call POST /auth/email/login "" "$B" >/dev/null; PARTNER=$(get "data['accessToken']")
BID=$(sql "select id from businesses where slug='old-bandipur-inn'")
ok "a partner uploads their business licence" 201 "$(upload "/businesses/$BID/documents" "$PARTNER" "$TMP/pan.jpg" BUSINESS_LICENCE)"
BDOC=$(get "data['id']")
ok "a traveller cannot see it" 404 "$(call GET "/businesses/$BID/documents" "$(login traveller@bato.test)")"
call DELETE "/businesses/$BID/documents/$BDOC" "$PARTNER" >/dev/null
rm -rf "$TMP"

echo "== keeping activity for 13 months, then only counts"
QR=$(sql "select id from qr_codes limit 1")
OLD_DAY=$(TZ=Asia/Kathmandu date -v-14m +%Y-%m-15)
OLD_MONTH=${OLD_DAY:0:7}
sql "insert into scan_events (id, \"qrCodeId\", \"sessionId\", \"ipHash\", \"isFirstScan\", \"scannedAt\") values
       (gen_random_uuid(), '$QR', 'retention-$STAMP-a', 'hash', true, '$OLD_DAY 06:00'), (gen_random_uuid(), '$QR', 'retention-$STAMP-a', 'hash', false, '$OLD_DAY 07:00'),
       (gen_random_uuid(), '$QR', 'retention-$STAMP-b', 'hash', true, '$OLD_DAY 08:00');
     insert into site_events (type, path, target, \"businessId\", \"sessionHash\", \"createdAt\") values
       ('IMPRESSION', '/partners/x', 'retention-$STAMP', '$BID', 'r1', '$OLD_DAY 06:00'), ('IMPRESSION', '/partners/x', 'retention-$STAMP', '$BID', 'r2', '$OLD_DAY 06:30'),
       ('CLICK', '/go/x', 'retention-$STAMP', '$BID', 'r1', '$OLD_DAY 06:05');" >/dev/null
(cd "$SMOKE_DIR/.." && npm run --silent retention >/dev/null 2>&1)
ok "old scans are gone one by one" 0 "$(sql "select count(*) from scan_events where \"sessionId\" like 'retention-$STAMP-%'")"
ok "but counted by day: 3 scans, 2 first scans, 2 devices" "3|2|2" "$(sql "select scans, \"firstScans\", sessions from scan_daily where \"qrCodeId\"='$QR' and day='$OLD_DAY'")"
ok "old website events too" 0 "$(sql "select count(*) from site_events where target='retention-$STAMP'")"
ok "kept as daily counts" "CLICK:1 IMPRESSION:2" "$(sql "select string_agg(type || ':' || count, ' ' order by type::text) from site_event_daily where target='retention-$STAMP'")"
ok "the partner's report for that month still shows them" "2 1" "$(call GET "/businesses/$BID/report?month=$OLD_MONTH" "$PARTNER" >/dev/null; get "f\"{data['totals']['impressions']} {data['totals']['clicks']}\"")"
ok "no address hash older than 13 months is left" 0 "$(sql "select count(*) from audit_events where \"ipHash\" is not null and \"createdAt\" < now() - interval '13 months'")"
sql "delete from scan_daily where \"qrCodeId\"='$QR' and day='$OLD_DAY'; delete from site_event_daily where target='retention-$STAMP';" >/dev/null

echo "== encrypted at rest"
OWNER=$(login owner.fleet@bato.test)
CID=$(sql "select id from operators where slug like 'himalayan%' limit 1")
ok "the owner reads drivers' phone numbers" 200 "$(call GET "/fleet/companies/$CID/drivers" "$OWNER")"
PHONE=$(get "[x['phone'] for x in data if x.get('phone')][0]")
ok "in clear, through the API" true "$(python3 -c "import sys; print(str(sys.argv[1].replace('+','').isdigit()).lower())" "$PHONE")"
"$PG_DUMP" -U travel -h localhost -d "$PGDATABASE" --data-only -t drivers -t operators -t income_entries -t emergency_contacts -t business_leads -t site_enquiries -t users > "$R.dump"
ok "a raw dump of those tables does not contain it" 0 "$(grep -c -- "$(echo "$PHONE" | tr -d '+')" "$R.dump")"
ok "every driver phone and licence is ciphertext" 0 "$(sql "select count(*) from drivers where phone not like 'enc:%' or (\"licenceNumber\" is not null and \"licenceNumber\" not like 'enc:%')")"
ok "company contact phones too, each with its search hash" 0 "$(sql "select count(*) from operators where \"contactPhone\" is not null and (\"contactPhone\" not like 'enc:%' or \"contactPhoneIdx\" is null)")"
ok "income notes too" 0 "$(sql "select count(*) from income_entries where note is not null and note <> '' and note not like 'enc:%'")"
ok "authenticator secrets too" 0 "$(sql "select count(*) from users where \"totpSecret\" is not null and \"totpSecret\" not like 'enc:%'")"
rm -f "$R.dump"
OP_PHONE=$(call GET "/fleet/admin/companies/$CID" "$ADMIN" >/dev/null; get "data.get('contactPhone') or data.get('company', {}).get('contactPhone') or ''")
if [ -n "$OP_PHONE" ]; then
  ok "an admin finds the company by its whole phone number" true "$(call GET "/fleet/admin/companies?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$OP_PHONE")" "$ADMIN" >/dev/null; get "any(c['id']=='$CID' for c in (data if isinstance(data, list) else data.get('items', [])))")"
fi

finish
