#!/bin/bash
# Bus owner portal API checks: access control, records, reminders, QR codes, passenger
# reviews and admin verification. Write actions use a throwaway bus that is deleted at
# the end, so the demo fleet is left exactly as it was.
#
#   bash scripts/fleet_smoke.sh ../../Bato_Docs/Bato_Test_Accounts.md
#
# Request bodies are built into variables before each call: macOS's bash 3.2 mangles
# escaped quotes written directly inside "$(...)".
API=${API:-http://localhost:3000/api/v1}
DOC=${1:?"usage: fleet_smoke.sh path/to/Bato_Test_Accounts.md"}
PSQL=${PSQL:-"$HOME/Applications/Postgres.app/Contents/Versions/16/bin/psql"}
HERE="$(cd "$(dirname "$0")" && pwd)"
R="$HERE/_resp.json"
export PGPASSWORD=${PGPASSWORD:-travel}
sql(){ "$PSQL" -U travel -h localhost -d travel_magazine -tAc "$1"; }

pass=0; fail=0
ok(){
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok    $1"
  else fail=$((fail+1)); echo "  FAIL  $1: expected $2, got $3  $(head -c 240 "$R")"; fi
}
call(){ # method path token [json] -> prints HTTP status, body in $R
  local args=(-s -o "$R" -w "%{http_code}" -X "$1" "$API$2" -H 'Content-Type: application/json')
  [ -n "$3" ] && args+=(-H "Authorization: Bearer $3")
  [ -n "$4" ] && args+=(-d "$4")
  curl "${args[@]}"
}
get(){ # python expression over the last response: d (whole body) or data
  python3 - "$R" "$1" <<'PY'
import sys, json
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    d = {}
try:
    v = eval(sys.argv[2], {"d": d, "data": d.get("data")})
except Exception as e:
    v = f"<{type(e).__name__}>"
print(str(v).lower() if isinstance(v, bool) else v)
PY
}
pw(){
  python3 - "$DOC" "$1" <<'PY'
import sys, re
t = open(sys.argv[1]).read(); b = t[t.index(sys.argv[2]):]
print(re.search(r"\*\*Password\*\* \| .([^|` ]+). ", b).group(1))
PY
}
totp(){
  python3 - "$1" <<'PY'
import sys, base64, hmac, hashlib, struct, time
s = sys.argv[1]; k = base64.b32decode(s.upper() + '=' * ((8 - len(s) % 8) % 8))
h = hmac.new(k, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest(); o = h[-1] & 15
print(f"{(struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000:06d}")
PY
}
login(){
  local body="{\"email\":\"$1\",\"password\":\"$(pw "$1")\"}"
  call POST /auth/email/login "" "$body" >/dev/null; get "data['accessToken']"
}
day(){ date -u -v"$1"d +%Y-%m-%d; }

START=$(date -u +"%Y-%m-%d %H:%M:%S")
SID="smoke_$(date +%s)"
# One of the words in common/utils/content-filter.ts, so the text is held for a moderator.
FILTERED_WORD=scam

echo "== sign in"
OWNER=$(login owner.fleet@bato.test); MANAGER=$(login manager.fleet@bato.test)
SINGLE=$(login owner.single@bato.test); PENDING=$(login owner.pending@bato.test); TRAV=$(login traveller@bato.test)
for who in OWNER MANAGER SINGLE PENDING TRAV; do
  tok=${!who}; ok "$who signed in without an authenticator" yes "$([ ${#tok} -gt 40 ] && echo yes || echo no)"
done

echo "== owner: company and dashboard"
ok "list companies" 200 "$(call GET /fleet/companies "$OWNER")"
ok "owner's company" "Himalayan Express Travels" "$(get "data[0]['name']")"
CID=$(get "data[0]['id']")
ok "dashboard" 200 "$(call GET /fleet/companies/$CID/dashboard "$OWNER")"
ok "dashboard counts 6 buses" 6 "$(get "data['totals']['buses']")"
ok "dashboard has reminders" true "$(get "len(data['reminders'])>0")"
ok "dashboard has satisfaction" true "$(get "data['satisfaction']['reviews']>0")"
ok "overdue service flagged" true "$(get "data['totals']['serviceOverdue']>=1")"
ok "expired document flagged" true "$(get "data['totals']['documentsExpired']>=1")"
ok "search own buses" 200 "$(call GET "/fleet/companies/$CID/buses?q=2346" "$OWNER")"
ok "Everest Deluxe 02 overdue" OVERDUE "$(get "data['items'][0]['service']['state']")"
BUS2=$(get "data['items'][0]['id']")

echo "== owner: register a bus"
ok "same plate written differently refused" 409 "$(call POST /fleet/companies/$CID/buses "$OWNER" '{"registrationNo":"ba-1-kha-2345"}')"
ok "refusal explains why" PLATE_TAKEN "$(get "d.get('code') or (d.get('error') or {}).get('code')")"
ok "number without digits refused" 400 "$(call POST /fleet/companies/$CID/buses "$OWNER" '{"registrationNo":"ABCDEF"}')"
ok "register throwaway bus" 201 "$(call POST /fleet/companies/$CID/buses "$OWNER" '{"registrationNo":"ba 9 kha 9999","label":"Smoke Test Bus","seatCount":30,"busType":"TOURIST_DELUXE","amenities":["AC","WIFI"],"odometerKm":50000}')"
SB=$(get "data['id']")
ok "plate tidied" "BA 9 KHA 9999" "$(get "data['registrationNo']")"
ok "no service recorded yet" NO_RECORD "$(get "data['service']['state']")"

echo "== owner: service, documents, fuel, crew, breakdowns"
B="{\"kind\":\"ROUTINE_SERVICE\",\"servicedAt\":\"$(day +10)\",\"odometerKm\":50100,\"title\":\"Full service\"}"
ok "future service date refused" 400 "$(call POST /fleet/buses/$SB/maintenance "$OWNER" "$B")"
B="{\"kind\":\"ROUTINE_SERVICE\",\"servicedAt\":\"$(day -30)\",\"odometerKm\":50500,\"title\":\"Full service\",\"photos\":[\"https://evil.example/x.jpg\"]}"
ok "photo from outside Bato refused" 400 "$(call POST /fleet/buses/$SB/maintenance "$OWNER" "$B")"
B="{\"kind\":\"ROUTINE_SERVICE\",\"servicedAt\":\"$(day -30)\",\"odometerKm\":50500,\"title\":\"Full service\",\"note\":\"Oil and filters\",\"workshop\":\"Smoke Garage\",\"costNpr\":15000,\"partsReplaced\":[\"Oil filter\",\"Air filter\"]}"
ok "service recorded" 201 "$(call POST /fleet/buses/$SB/maintenance "$OWNER" "$B")"
ok "parts saved" 2 "$(get "len(data['partsReplaced'])")"
call GET /fleet/buses/$SB "$OWNER" >/dev/null
ok "service status now OK" OK "$(get "data['service']['state']")"
ok "odometer moved forward" 50500 "$(get "data['odometerKm']")"
ok "next service due in 60 days" 60 "$(get "data['service']['daysLeft']")"
B="{\"type\":\"INSURANCE\",\"number\":\"SMOKE-1\",\"expiresAt\":\"$(day +10)\"}"
ok "document added" 201 "$(call POST /fleet/buses/$SB/documents "$OWNER" "$B")"
ok "insurance expiring" EXPIRING "$(get "data['state']")"
B="{\"filledAt\":\"$(day -10)\",\"odometerKm\":50600,\"litres\":150,\"costNpr\":26700}"
ok "fill-up logged" 201 "$(call POST /fleet/buses/$SB/fuel "$OWNER" "$B")"
B="{\"filledAt\":\"$(day -5)\",\"odometerKm\":51250,\"litres\":160,\"costNpr\":28480}"
ok "second fill-up" 201 "$(call POST /fleet/buses/$SB/fuel "$OWNER" "$B")"
B="{\"filledAt\":\"$(day -0)\",\"odometerKm\":50700,\"litres\":100,\"costNpr\":17800}"
ok "reading lower than an earlier fill refused" 400 "$(call POST /fleet/buses/$SB/fuel "$OWNER" "$B")"
call GET /fleet/buses/$SB/fuel "$OWNER" >/dev/null
ok "mileage 650 km / 160 L" 4.06 "$(get "data['economy']['kmPerLitre']")"
call GET /fleet/companies/$CID/drivers "$OWNER" >/dev/null
ok "crew listed" 8 "$(get "len(data)")"
SUMAN=$(get "[x['id'] for x in data if x['name']=='Suman Rai'][0]")
B="{\"driverId\":\"$SUMAN\"}"
ok "assign driver" 201 "$(call POST /fleet/buses/$SB/crew "$OWNER" "$B")"
ok "driver on the bus" "Suman Rai" "$(get "data['current'][0]['name']")"
B="{\"kind\":\"ENGINE\",\"severity\":\"MAJOR\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"location\":\"Naubise\",\"description\":\"Engine overheating on the climb\",\"driverId\":\"$SUMAN\"}"
ok "breakdown reported" 201 "$(call POST /fleet/buses/$SB/incidents "$OWNER" "$B")"
INC=$(get "data['id']")
call GET /fleet/buses/$SB "$OWNER" >/dev/null
ok "major breakdown takes bus off the road" IN_MAINTENANCE "$(get "data['status']")"
ok "breakdown fixed" 200 "$(call PATCH /fleet/incidents/$INC/resolve "$OWNER" '{"resolutionNote":"Radiator hose replaced","repairCostNpr":4500,"addToServiceHistory":true}')"
ok "cannot fix it twice" 400 "$(call PATCH /fleet/incidents/$INC/resolve "$OWNER" '{"resolutionNote":"again"}')"
call GET /fleet/buses/$SB "$OWNER" >/dev/null
ok "bus back in service" ACTIVE "$(get "data['status']")"
ok "repair written to service history" 2 "$(get "data['counts']['maintenance']")"
ok "history export" 200 "$(call GET /fleet/buses/$SB/history "$OWNER")"
ok "export has every section" true "$(get "all(k in data for k in ('maintenance','incidents','documents','fuel','crew')) and len(data['maintenance'])==2")"

echo "== QR codes and passengers"
ok "bus QR" 200 "$(call GET /fleet/buses/$SB/qr "$OWNER")"
ok "QR image is SVG" true "$(get "'<svg' in data['svg']")"
QR1=$(get "data['code']")
B="{\"sessionId\":\"${SID}_a\"}"
ok "scan bus QR" 201 "$(call POST /buses/scan/$QR1 "" "$B")"
ok "scan opens that bus" "$SB" "$(get "data['bus']['id']")"
TOKEN=$(get "data['scanToken']")
B="{\"overall\":4,\"sessionId\":\"${SID}_b\"}"
ok "review with no scan or sign-in refused" 403 "$(call POST /buses/$SB/reviews "" "$B")"
B="{\"overall\":2,\"cleanliness\":2,\"comment\":\"Smoke test review, the bus was late\",\"suggestion\":\"Leave on time\",\"scanToken\":\"$TOKEN\",\"sessionId\":\"${SID}_a\"}"
ok "review after scanning" 201 "$(call POST /buses/$SB/reviews "" "$B")"
RV=$(get "data['id']")
ok "marked as a verified ride" true "$(get "data['verifiedRide']")"
ok "second review the same day refused" 409 "$(call POST /buses/$SB/reviews "" "$B")"
B="{\"overall\":5,\"scanToken\":\"$TOKEN\",\"sessionId\":\"${SID}_c\"}"
ok "scan token refused on another bus" 400 "$(call POST /buses/$BUS2/reviews "" "$B")"
ok "refusal says why" SCAN_EXPIRED "$(get "d.get('code')")"
ok "scan token is not a session" 401 "$(call GET /fleet/companies "$TOKEN")"
ok "signed-in traveller review" 201 "$(call POST /buses/$SB/reviews "$TRAV" '{"overall":5,"comment":"Smoke test: smooth ride"}')"
B="{\"overall\":1,\"comment\":\"$FILTERED_WORD driver\",\"scanToken\":\"$TOKEN\",\"sessionId\":\"${SID}_f\"}"
ok "word filter holds abusive review" false "$(call POST /buses/$SB/reviews "" "$B" >/dev/null; get "data['published']")"
call GET /fleet/companies/$CID/qr "$OWNER" >/dev/null; CQR=$(get "data['code']")
B="{\"sessionId\":\"${SID}_d\"}"
ok "scan company QR" 201 "$(call POST /buses/scan/$CQR "" "$B")"
ok "company page lists its buses" true "$(get "data['company']['busCount']>=6")"
CTOKEN=$(get "data['scanToken']")
B="{\"overall\":3,\"scanToken\":\"$CTOKEN\",\"sessionId\":\"${SID}_d\"}"
ok "company scan can review its buses" 201 "$(call POST /buses/$SB/reviews "" "$B")"
ok "public profile" 200 "$(call GET /buses/$SB)"
ok "public rating counts 3 live reviews" 3 "$(get "data['rating']['reviews']")"
ok "public reviews hide suggestions" false "$(get "'suggestion' in data['reviews']['items'][0]")"
ok "search by plate" true "$(call GET '/buses/search?q=ba9kha' >/dev/null; get "any(b['id']=='$SB' for b in data)")"
ok "low rating notifies the company" true "$(call GET /fleet/companies/$CID/notifications "$OWNER" >/dev/null; get "any(n['kind']=='LOW_RATING' and n['vehicleId']=='$SB' for n in data['items'])")"
ok "replace sticker" 201 "$(call POST /fleet/buses/$SB/qr/rotate "$OWNER")"
ok "new code issued" true "$(get "data['code']!='$QR1'")"
ok "old sticker stops working" 404 "$(call POST /buses/scan/$QR1 "" '{}')"
PB=$(sql "select q.\"shortCode\" from qr_codes q join vehicles v on v.id=q.\"vehicleId\" where v.\"plateKey\"='GA3KHA1001' and q.\"isActive\" limit 1")
ok "unverified company's QR inactive" 404 "$(call POST /buses/scan/$PB "" '{}')"
ok "unverified buses not searchable" 0 "$(call GET '/buses/search?q=Night%20Rider' >/dev/null; get "len(data)")"
B="{\"sessionId\":\"${SID}_e\"}"
ok "seat sticker offers a bus review" true "$(call POST /qr/r/DEMO2024 "" "$B" >/dev/null; get "bool(data['bus'] and data['bus']['scanToken'])")"

echo "== owner: feedback"
ok "feedback analytics" 200 "$(call GET "/fleet/companies/$CID/reviews?busId=$SB" "$OWNER")"
ok "owner sees the suggestion" "Leave on time" "$(get "[r for r in data['items'] if r['id']=='$RV'][0]['suggestion']")"
ok "owner sees held review marked" true "$(get "any(r['moderation']=='PENDING' for r in data['items'])")"
ok "owner never sees who wrote it" false "$(get "any(k in r for r in data['items'] for k in ('userId','sessionId','ipHash'))")"
ok "reply to a review" 201 "$(call POST /fleet/reviews/$RV/reply "$OWNER" '{"reply":"Sorry about the delay, we have changed the timetable."}')"
ok "reply is public" true "$(call GET /buses/$SB >/dev/null; get "any(r['ownerReply'] for r in data['reviews']['items'])")"
ok "impolite reply refused" 400 "$(call POST /fleet/reviews/$RV/reply "$OWNER" '{"reply":"your review is a scam"}')"
ok "report a review" 201 "$(call POST /fleet/reviews/$RV/report "$OWNER" '{"reason":"SPAM","detail":"smoke test"}')"

echo "== access control"
B="{\"kind\":\"TYRES\",\"servicedAt\":\"$(day -1)\",\"odometerKm\":51300,\"title\":\"Tyre rotation\"}"
ok "manager can record service" 201 "$(call POST /fleet/buses/$SB/maintenance "$MANAGER" "$B")"
ok "manager cannot edit company" 403 "$(call PATCH /fleet/companies/$CID "$MANAGER" '{"description":"x"}')"
ok "manager cannot add team members" 403 "$(call POST /fleet/companies/$CID/members "$MANAGER" '{"email":"traveller@bato.test","role":"MANAGER"}')"
ok "manager cannot archive buses" 403 "$(call PATCH /fleet/buses/$SB/archive "$MANAGER" '{"archived":true}')"
ok "other company: bus not found" 404 "$(call GET /fleet/buses/$SB "$SINGLE")"
ok "other company: dashboard not found" 404 "$(call GET /fleet/companies/$CID/dashboard "$SINGLE")"
ok "other company: cannot reply" 404 "$(call POST /fleet/reviews/$RV/reply "$SINGLE" '{"reply":"hello"}')"
B="{\"filledAt\":\"$(day -1)\",\"odometerKm\":60000,\"litres\":10,\"costNpr\":1780}"
ok "other company: cannot add fuel" 404 "$(call POST /fleet/buses/$SB/fuel "$SINGLE" "$B")"
B="{\"driverId\":\"$SUMAN\"}"
ok "other company: cannot assign crew" 404 "$(call POST /fleet/buses/$SB/crew "$SINGLE" "$B")"
ok "traveller has no companies" 0 "$(call GET /fleet/companies "$TRAV" >/dev/null; get "len(data)")"
ok "signed out: portal refused" 401 "$(call GET /fleet/companies "")"
ok "owner cannot use the admin API" 403 "$(call GET /fleet/admin/stats "$OWNER")"
B="{\"operatorId\":\"$CID\",\"count\":1}"
ok "owner cannot mint seat stickers" 403 "$(call POST /qr/batch "$OWNER" "$B")"
ok "old anonymous feedback route gone" 404 "$(call POST /operators/feedback "" '{}')"
ok "pending owner sees status" PENDING "$(call GET /fleet/companies "$PENDING" >/dev/null; get "data[0]['verification']")"
PCID=$(get "data[0]['id']")

echo "== admin"
B="{\"email\":\"tester.admin@bato.test\",\"password\":\"$(pw tester.admin@bato.test)\"}"
call POST /auth/email/login "" "$B" >/dev/null
CH=$(get "data['challengeToken']")
SECRET=$(sql "select \"totpSecret\" from users where email='tester.admin@bato.test'")
B="{\"challengeToken\":\"$CH\",\"code\":\"$(totp "$SECRET")\"}"
call POST /auth/mfa/verify "" "$B" >/dev/null
ADMIN=$(get "data['accessToken']")
ok "fleet stats" 200 "$(call GET /fleet/admin/stats "$ADMIN")"
ok "stats count registered buses" true "$(get "data['buses']['registered']>=10")"
ok "pending companies listed" true "$(call GET '/fleet/admin/companies?status=PENDING' "$ADMIN" >/dev/null; get "any(c['name']=='Pokhara Night Riders' for c in data)")"
ok "company detail" 200 "$(call GET /fleet/admin/companies/$PCID "$ADMIN")"
ok "rejecting needs a reason" 400 "$(call PATCH /fleet/admin/companies/$PCID/verification "$ADMIN" '{"status":"REJECTED"}')"
ok "verify company" 200 "$(call PATCH /fleet/admin/companies/$PCID/verification "$ADMIN" '{"status":"VERIFIED","note":"smoke test"}')"
ok "verified company's QR works" 201 "$(call POST /buses/scan/$PB "" '{}')"
ok "owner notified" "Your company is verified" "$(call GET /fleet/companies/$PCID/notifications "$PENDING" >/dev/null; get "data['items'][0]['title']")"
ok "back to pending" 200 "$(call PATCH /fleet/admin/companies/$PCID/verification "$ADMIN" '{"status":"PENDING","note":"smoke test"}')"
ok "QR paused again" 404 "$(call POST /buses/scan/$PB "" '{}')"
ok "held bus review in moderation queue" true "$(call GET /moderation/queue "$ADMIN" >/dev/null; get "data['pendingBusReviews']>=1")"
ok "bus review reaches reports" true "$(call GET /moderation/reports "$ADMIN" >/dev/null; get "any(g['targetType']=='BUS_REVIEW' and g['targetId']=='$RV' and g['preview'] for g in data)")"
B="{\"targetType\":\"BUS_REVIEW\",\"targetId\":\"$RV\",\"action\":\"DELETE\",\"note\":\"smoke test\"}"
ok "moderator removes it" 201 "$(call POST /moderation/act "$ADMIN" "$B")"
ok "removed from public profile" 2 "$(call GET /buses/$SB >/dev/null; get "data['rating']['reviews']")"
ok "reminder job runs" 201 "$(call POST /fleet/admin/reminders/run "$ADMIN")"

echo "== clean up"
ok "archive throwaway bus" 200 "$(call PATCH /fleet/buses/$SB/archive "$OWNER" '{"archived":true}')"
ok "archived bus leaves public view" 404 "$(call GET /buses/$SB)"
ok "delete throwaway bus" 200 "$(call DELETE /fleet/buses/$SB "$OWNER")"
sql "delete from reports where detail='smoke test' or \"targetId\"='$RV';
     delete from moderation_entries where note='smoke test';
     delete from fleet_notifications where \"operatorId\"='$PCID' and \"createdAt\" >= '$START';
     update operators set \"verificationNote\"=null where id='$PCID';" >/dev/null

rm -f "$R"
echo
echo "$pass passed, $fail failed"
exit $fail
