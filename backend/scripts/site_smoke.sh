#!/bin/bash
# The public website's side of the API (Phase 3, Feature 3), against a running API:
# forms only from the site's own server (SITE_API_KEY), the honeypot, enquiries and
# leads, double opt-in for the newsletter, public audience figures, a partner's own
# enquiries and monthly report (and 404 for anyone else's), ending a deal, and the
# control panel's partner packages, enquiry inbox and newsletter export, audited.
#
# Uses the demo partner from `npm run seed` (its password is the seed's) and the test
# accounts file for staff. Everything it creates is removed again.
#
#   bash scripts/site_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: site_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

KEY=$(sed -n 's/^SITE_API_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$SMOKE_DIR/../.env")
SEED_PW=$(grep -o "BatoDemo#[0-9]*" "$SMOKE_DIR/../prisma/seed.ts" | head -1)
PARTNER_EMAIL=business-owner@demo.bato.travel
START=$(date -u +"%Y-%m-%d %H:%M:%S")
STAMP=$(date +%s)
site(){ # method path [json] [key] -> HTTP status, body in $R; posts as the website does
  local args=(-s -o "$R" -w "%{http_code}" -X "$1" "$API$2" -H 'Content-Type: application/json' -H "x-site-client-ip: 203.0.113.7")
  [ -n "$4" ] && args+=(-H "x-site-key: $4")
  [ -n "$3" ] && args+=(-d "$3")
  curl "${args[@]}"
}
id_of(){ sql "select id from $1 where $2 limit 1"; }
BANDIPUR=$(id_of businesses "slug='old-bandipur-inn'")
MUSTANG=$(id_of businesses "slug='mustang-jeep-service'")
MUSTANG_OWNER=$(sql "select \"ownerId\" from businesses where id='$MUSTANG'")
TRAVELLER_ID=$(id_of users "email='traveller@bato.test'")
# Mustang's verification and tier as they were, put back at the end.
MUSTANG_STATE=$(sql "select concat_ws('|', tier, coalesce(\"verifiedAt\"::text, ''), coalesce(\"verifiedBy\", ''), coalesce(\"verificationNote\", ''), coalesce(\"subscriptionEndsAt\"::text, '')) from businesses where id='$MUSTANG'")
IFS='|' read -r M_TIER M_VAT M_VBY M_NOTE M_SUB <<< "$MUSTANG_STATE"
q_or_null(){ [ -n "$1" ] && echo "'$1'" || echo null; }
cleanup(){
  sql "update businesses set \"ownerId\"='$MUSTANG_OWNER', tier='$M_TIER', \"verifiedAt\"=$(q_or_null "$M_VAT"), \"verifiedBy\"=$(q_or_null "$M_VBY"),
         \"verificationNote\"=$(q_or_null "$M_NOTE"), \"subscriptionEndsAt\"=$(q_or_null "$M_SUB") where id='$MUSTANG';
       delete from subscription_events where \"businessId\"='$MUSTANG' and \"createdAt\" >= '$START';
       delete from business_leads where message like 'smoke-$STAMP%';
       delete from site_enquiries where message like 'smoke-$STAMP%';
       delete from newsletter_subscribers where email like 'smoke-$STAMP%';
       delete from partner_packages where notes like 'smoke-$STAMP%';
       delete from coupons where title like 'smoke-$STAMP%';" >/dev/null
}
trap cleanup EXIT

echo "== sign in"
B="{\"email\":\"$PARTNER_EMAIL\",\"password\":\"$SEED_PW\"}"
call POST /auth/email/login "" "$B" >/dev/null; PARTNER=$(get "data['accessToken']")
ok "the demo partner signs in" BUSINESS_OWNER "$(get "data['user']['role']")"
TRAVELLER=$(login traveller@bato.test)
ADMIN=$(staff_login tester.admin@bato.test)
EDITOR=$(staff_login tester.editor@bato.test)

echo "== only the website's own server can post"
B="{\"kind\":\"CONTACT\",\"name\":\"Smoke\",\"contact\":\"smoke@example.com\",\"message\":\"smoke-$STAMP no key\"}"
ok "no key: refused" 403 "$(site POST /site/enquiries "$B")"
ok "a wrong key: refused" 403 "$(site POST /site/enquiries "$B" "not-the-key-$STAMP")"
ok "a signed-in traveller without the key: refused" 403 "$(call POST /site/enquiries "$TRAVELLER" "$B")"

echo "== enquiries to Batoma"
B="{\"kind\":\"CONTACT\",\"name\":\"Smoke Tester\",\"contact\":\"smoke@example.com\",\"message\":\"smoke-$STAMP a question\"}"
ok "a contact message is accepted" 201 "$(site POST /site/enquiries "$B" "$KEY")"
ok "and stored, new, with the visitor's address hashed" "NEW true" "$(sql "select status || ' ' || (\"ipHash\" is not null and \"ipHash\" <> '203.0.113.7') from site_enquiries where message='smoke-$STAMP a question'")"
B="{\"kind\":\"ADVERTISE\",\"name\":\"Smoke Hotel\",\"organisation\":\"Smoke Lodge\",\"contact\":\"9800000000\",\"message\":\"smoke-$STAMP rates please\"}"
ok "an advertising enquiry is accepted" 201 "$(site POST /site/enquiries "$B" "$KEY")"
B="{\"kind\":\"CONTACT\",\"name\":\"Bot\",\"contact\":\"bot@example.com\",\"message\":\"smoke-$STAMP bot\",\"website\":\"http://spam.example\"}"
ok "a bot that fills the hidden field is told it worked" 201 "$(site POST /site/enquiries "$B" "$KEY")"
ok "and nothing is stored" 0 "$(sql "select count(*) from site_enquiries where message='smoke-$STAMP bot'")"
B="{\"kind\":\"CONTACT\",\"name\":\"S\",\"contact\":\"x\",\"message\":\"hi\"}"
ok "too short: refused with a reason" 400 "$(site POST /site/enquiries "$B" "$KEY")"
ok "the reason is a sentence" true "$(get "'name' in d['message'].lower()")"

echo "== messages to a partner"
B="{\"businessSlug\":\"old-bandipur-inn\",\"name\":\"Smoke Traveller\",\"contact\":\"smoke.t@example.com\",\"message\":\"smoke-$STAMP two rooms\"}"
ok "a message to a verified partner is accepted" 201 "$(site POST /site/leads "$B" "$KEY")"
ok "stored as a website enquiry for that partner" "ENQUIRY SITE $BANDIPUR" "$(sql "select type || ' ' || channel || ' ' || \"businessId\" from business_leads where message='smoke-$STAMP two rooms'")"
B="{\"businessSlug\":\"mustang-jeep-service\",\"name\":\"Smoke Traveller\",\"contact\":\"smoke.t@example.com\",\"message\":\"smoke-$STAMP unverified\"}"
ok "an unverified listing takes no messages" 404 "$(site POST /site/leads "$B" "$KEY")"
B="{\"businessSlug\":\"no-such-partner-$STAMP\",\"name\":\"Smoke\",\"contact\":\"smoke@example.com\",\"message\":\"smoke-$STAMP nobody\"}"
ok "nor does a partner that does not exist" 404 "$(site POST /site/leads "$B" "$KEY")"

echo "== the newsletter, double opt-in"
EMAIL="smoke-$STAMP@example.com"
B="{\"email\":\"$EMAIL\",\"source\":\"smoke\"}"
ok "subscribing answers the same either way" 201 "$(site POST /site/newsletter "$B" "$KEY")"
ok "the address waits for confirmation" PENDING "$(sql "select status from newsletter_subscribers where email='$EMAIL'")"
ok "a second request does not reveal anything" 201 "$(site POST /site/newsletter "$B" "$KEY")"
ok "only a hash of the confirmation token is stored" 64 "$(sql "select length(\"confirmTokenHash\") from newsletter_subscribers where email='$EMAIL'")"
TOKEN="smoketoken$STAMP$STAMP"
HASH=$(printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
sql "update newsletter_subscribers set \"confirmTokenHash\"='$HASH' where email='$EMAIL'" >/dev/null
B="{\"token\":\"wrongtoken$STAMP$STAMP\"}"
ok "a wrong token confirms nothing" 400 "$(site POST /site/newsletter/confirm "$B" "$KEY")"
B="{\"token\":\"$TOKEN\"}"
ok "the right one confirms" 201 "$(site POST /site/newsletter/confirm "$B" "$KEY")"
UNSUB=$(get "data['unsubscribeToken']")
ok "now confirmed" CONFIRMED "$(sql "select status from newsletter_subscribers where email='$EMAIL'")"
ok "and the link cannot be used twice" 400 "$(site POST /site/newsletter/confirm "$B" "$KEY")"
B="{\"token\":\"$UNSUB\"}"
ok "one click unsubscribes" 201 "$(site POST /site/newsletter/unsubscribe "$B" "$KEY")"
ok "and it sticks" UNSUBSCRIBED "$(sql "select status from newsletter_subscribers where email='$EMAIL'")"
B="{\"token\":\"unknowntoken$STAMP$STAMP\"}"
ok "an unknown unsubscribe token gets the same answer" 201 "$(site POST /site/newsletter/unsubscribe "$B" "$KEY")"

echo "== audience figures for Advertise"
ok "public" 200 "$(call GET /site/audience "")"
ok "plain counts" true "$(get "all(isinstance(data[k], int) for k in ['scansLast30Days','readersLast30Days','websiteViewsLast30Days','buses','routes','partners','articles'])")"

echo "== a partner's own enquiries and report"
ok "the partner reads their enquiries" 200 "$(call GET "/businesses/$BANDIPUR/leads" "$PARTNER")"
ok "the website message is there, with its contact" "smoke.t@example.com" "$(get "[l for l in data['items'] if l['message']=='smoke-$STAMP two rooms'][0]['contact']")"
MONTH=$(TZ=Asia/Kathmandu date +%Y-%m)
ok "the monthly report" 200 "$(call GET "/businesses/$BANDIPUR/report?month=$MONTH" "$PARTNER")"
ok "counts the enquiry" true "$(get "data['totals']['enquiries'] >= 1")"
ok "one row per day of the month" "$(python3 -c "import calendar,sys; y,m=map(int,sys.argv[1].split('-')); print(calendar.monthrange(y,m)[1])" "$MONTH")" "$(get "len(data['days'])")"
ok "a future month is refused" 400 "$(call GET "/businesses/$BANDIPUR/report?month=2099-01" "$PARTNER")"
ok "a malformed month is refused" 400 "$(call GET "/businesses/$BANDIPUR/report?month=October" "$PARTNER")"
CSV=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$API/businesses/$BANDIPUR/report.csv?month=$MONTH" -H "Authorization: Bearer $PARTNER")
ok "as a spreadsheet" "200 text/csv; charset=utf-8" "$CSV"
PDF=$(curl -s "$API/businesses/$BANDIPUR/report.pdf?month=$MONTH" -H "Authorization: Bearer $PARTNER" | head -c 5)
ok "and as a PDF" "%PDF-" "$PDF"

echo "== nobody else's"
# For this run the traveller owns the unverified Mustang listing.
sql "update businesses set \"ownerId\"='$TRAVELLER_ID' where id='$MUSTANG'" >/dev/null
ok "the demo partner cannot read another owner's enquiries" 404 "$(call GET "/businesses/$MUSTANG/leads" "$PARTNER")"
ok "nor their report" 404 "$(call GET "/businesses/$MUSTANG/report" "$PARTNER")"
ok "nor download it" 404 "$(curl -s -o /dev/null -w "%{http_code}" "$API/businesses/$MUSTANG/report.csv" -H "Authorization: Bearer $PARTNER")"
ok "the other owner cannot read the demo partner's" 404 "$(call GET "/businesses/$BANDIPUR/leads" "$TRAVELLER")"
ok "but does read their own" 200 "$(call GET "/businesses/$MUSTANG/leads" "$TRAVELLER")"
ok "an editor is not a partner" 404 "$(call GET "/businesses/$BANDIPUR/report" "$EDITOR")"
ok "an admin can read any partner's report" 200 "$(call GET "/businesses/$BANDIPUR/report" "$ADMIN")"
ok "signed out: no" 401 "$(call GET "/businesses/$BANDIPUR/leads" "")"
ok "a non-id is refused" 400 "$(call GET "/businesses/not-an-id/leads" "$PARTNER")"

echo "== ending a deal"
B="{\"title\":\"smoke-$STAMP deal\",\"discountLabel\":\"5% off\",\"validTo\":\"$(iso 864000)\"}"
ok "the partner publishes a deal" 201 "$(call POST "/businesses/$BANDIPUR/coupons" "$PARTNER" "$B")"
DEAL=$(get "data['id']")
ok "another owner cannot end it" 404 "$(call PATCH "/businesses/coupons/$DEAL/end" "$TRAVELLER")"
ok "the partner ends it" false "$(call PATCH "/businesses/coupons/$DEAL/end" "$PARTNER" >/dev/null; get "data['isActive']")"
ok "the dashboard shows it ended" false "$(call GET "/businesses/$BANDIPUR/dashboard" "$PARTNER" >/dev/null; get "[c for c in data['coupons'] if c['id']=='$DEAL'][0]['isActive']")"

echo "== verifying a listing and setting its tier"
MODERATOR=$(staff_login tester.moderator@bato.test)
B='{"verificationNote":"smoke: checked by phone"}'
ok "an editor cannot verify" 403 "$(call PATCH "/businesses/$MUSTANG/verify" "$EDITOR" "$B")"
ok "a note is required" 400 "$(call PATCH "/businesses/$MUSTANG/verify" "$MODERATOR" '{"verificationNote":"ok"}')"
ok "a moderator verifies it" 200 "$(call PATCH "/businesses/$MUSTANG/verify" "$MODERATOR" "$B")"
ok "verified, as Verified" "VERIFIED true" "$(get "data['tier'] + ' ' + str(bool(data['verifiedAt'])).lower()")"
ok "audited with the note" 1 "$(sql "select count(*) from audit_events where action='business.verify' and \"entityId\"='$MUSTANG' and summary like '%checked by phone%' and \"createdAt\" >= '$START'")"
B="{\"businessSlug\":\"mustang-jeep-service\",\"name\":\"Smoke\",\"contact\":\"smoke@example.com\",\"message\":\"smoke-$STAMP verified now\"}"
ok "it now takes messages from the website" 201 "$(site POST /site/leads "$B" "$KEY")"
ok "a moderator cannot set the tier" 403 "$(call PATCH "/businesses/$MUSTANG/tier" "$MODERATOR" '{"tier":"FEATURED","months":2}')"
ok "an unknown tier is refused" 400 "$(call PATCH "/businesses/$MUSTANG/tier" "$ADMIN" '{"tier":"GOLD"}')"
ok "more than two years is refused" 400 "$(call PATCH "/businesses/$MUSTANG/tier" "$ADMIN" '{"tier":"FEATURED","months":30}')"
ok "an admin makes it featured for two months" FEATURED "$(call PATCH "/businesses/$MUSTANG/tier" "$ADMIN" '{"tier":"FEATURED","months":2}' >/dev/null; get "data['tier']")"
ok "audited" 1 "$(sql "select count(*) from audit_events where action='business.tier' and \"entityId\"='$MUSTANG' and \"createdAt\" >= '$START'")"

echo "== partner packages (admins only)"
B="{\"businessId\":\"$BANDIPUR\",\"kind\":\"HOME_HERO\",\"startsAt\":\"$(iso 0)\",\"endsAt\":\"$(iso 2592000)\",\"pricePaisa\":1500000,\"notes\":\"smoke-$STAMP\"}"
ok "an editor cannot sell packages" 403 "$(call POST /admin/partner-packages "$EDITOR" "$B")"
ok "a partner cannot either" 403 "$(call POST /admin/partner-packages "$PARTNER" "$B")"
ok "an admin records one" 201 "$(call POST /admin/partner-packages "$ADMIN" "$B")"
PKG=$(get "data['id']")
ok "proposed by default, price in paisa" "PROPOSED 1500000" "$(get "f\"{data['status']} {data['pricePaisa']}\"")"
ok "audited" 1 "$(sql "select count(*) from audit_events where action='package.create' and \"entityId\"='$PKG'")"
B="{\"startsAt\":\"$(iso 86400)\",\"endsAt\":\"$(iso 3600)\"}"
ok "an end before the start is refused" 400 "$(call PATCH "/admin/partner-packages/$PKG" "$ADMIN" "$B")"
ok "made active" ACTIVE "$(call PATCH "/admin/partner-packages/$PKG" "$ADMIN" '{"status":"ACTIVE"}' >/dev/null; get "data['status']")"
ok "the change is audited with before and after" 1 "$(sql "select count(*) from audit_events where action='package.update' and \"entityId\"='$PKG' and before is not null and after is not null")"
ok "listed for that partner" true "$(call GET "/admin/partner-packages?businessId=$BANDIPUR" "$ADMIN" >/dev/null; get "any(p['id']=='$PKG' and p['business']['slug']=='old-bandipur-inn' for p in data)")"
ok "the partner's report from the panel" 200 "$(call GET "/admin/partner-packages/report/$BANDIPUR?month=$MONTH" "$ADMIN")"

echo "== enquiry inbox and newsletter list (admins only)"
ok "an editor cannot read the inbox" 403 "$(call GET /admin/site/enquiries "$EDITOR")"
ok "the admin sees new enquiries" true "$(call GET "/admin/site/enquiries?status=NEW" "$ADMIN" >/dev/null; get "any(e['message']=='smoke-$STAMP a question' for e in data['items'])")"
ENQ=$(sql "select id from site_enquiries where message='smoke-$STAMP a question'")
ok "and marks one handled" HANDLED "$(call PATCH "/admin/site/enquiries/$ENQ" "$ADMIN" '{"status":"HANDLED"}' >/dev/null; get "data['status']")"
ok "audited" 1 "$(sql "select count(*) from audit_events where action='enquiry.status' and \"entityId\"='$ENQ'")"
ok "newsletter counts" "confirmed pending unsubscribed" "$(call GET /admin/site/newsletter "$ADMIN" >/dev/null; get "' '.join(sorted(data))")"
ok "the CSV export" 200 "$(curl -s -o /dev/null -w "%{http_code}" "$API/admin/site/newsletter.csv" -H "Authorization: Bearer $ADMIN")"
ok "is audited" 1 "$(sql "select least(count(*), 1) from audit_events where action='newsletter.export' and \"createdAt\" >= '$START'")"
ok "an editor cannot export it" 403 "$(curl -s -o /dev/null -w "%{http_code}" "$API/admin/site/newsletter.csv" -H "Authorization: Bearer $EDITOR")"

finish
