#!/bin/bash
# One QR per bus (Phase 3, Feature 2): the bus's code opens its magazine at /b/<code>,
# stickers come out of the server as PDF, PNG and SVG with a print history, replacing a
# sticker kills the old code at once (and is audited), an old bus.html?code= sticker can
# be peeked at without counting a scan, and another company or a crew account gets
# nowhere. The bus it changes is put back as it was.
#
#   bash scripts/qr_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: qr_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

id_of(){ sql "select id from $1 where $2 limit 1"; }
CID=$(id_of operators "slug like 'himalayan%'")
BUS=$(id_of vehicles "\"plateKey\"='BA1KHA2346'")
OLD=$(sql "select \"shortCode\" from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"isActive\"")
START=$(date -u +"%Y-%m-%d %H:%M:%S")
status_type(){ # path token -> "status content-type"
  curl -s -o "$R" -w "%{http_code} %{content_type}" "$API$1" -H "Authorization: Bearer $2"
}

echo "== sign in"
OWNER=$(login owner.fleet@bato.test); CREW=$(login crew.fleet@bato.test); SINGLE=$(login owner.single@bato.test)
ADMIN=$(staff_login tester.admin@bato.test)

echo "== the bus's code"
ok "the bus has exactly one active code" 1 "$(sql "select count(*) from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"isActive\"")"
ok "the portal shows its permanent short link" true "$(call GET "/fleet/buses/$BUS/qr" "$OWNER" >/dev/null; get "data['url'].endswith('/b/$OLD')")"
ok "scanning it opens the magazine for the bus's route" KTM-PKR "$(call POST "/qr/r/$OLD" "" '{"refresh":true}' >/dev/null; get "data['route']['code']")"
ok "and offers the bus for rating" true "$(get "bool(data['bus']['scanToken'])")"

echo "== stickers"
ok "A6 PDF" "200 application/pdf" "$(status_type "/fleet/buses/$BUS/qr/sticker?format=pdf&size=a6" "$OWNER")"
ok "it is a real PDF" "%PDF-" "$(head -c 5 "$R")"
ok "seat-back PDF" "200 application/pdf" "$(status_type "/fleet/buses/$BUS/qr/sticker?format=pdf&size=seat" "$OWNER")"
ok "PNG" "200 image/png" "$(status_type "/fleet/buses/$BUS/qr/sticker?format=png" "$OWNER")"
ok "SVG" "200 image/svg+xml" "$(status_type "/fleet/buses/$BUS/qr/sticker?format=svg" "$OWNER")"
ok "a size that does not exist is refused" 400 "$(call GET "/fleet/buses/$BUS/qr/sticker?size=a3" "$OWNER")"
ok "the whole fleet on A4 sheets" "200 application/pdf" "$(status_type "/fleet/companies/$CID/qr/stickers.pdf" "$OWNER")"
ok "each download is in the print history" true "$(call GET "/fleet/buses/$BUS/qr" "$OWNER" >/dev/null; get "len([p for p in data['prints'] if p['current']])>=5")"
ok "another company cannot download it" 404 "$(call GET "/fleet/buses/$BUS/qr/sticker" "$SINGLE")"
ok "another company cannot print the fleet" 404 "$(call GET "/fleet/companies/$CID/qr/stickers.pdf" "$SINGLE")"
ok "a crew account cannot print stickers" 403 "$(call GET "/fleet/buses/$BUS/qr/sticker" "$CREW")"
ok "an owner cannot use the admin's copy" 403 "$(call GET "/fleet/admin/buses/$BUS/qr/sticker" "$OWNER")"
ok "Batoma's admin can print it" "200 application/pdf" "$(status_type "/fleet/admin/buses/$BUS/qr/sticker" "$ADMIN")"
ok "and the company's sheet" "200 application/pdf" "$(status_type "/fleet/admin/companies/$CID/qr/stickers.pdf" "$ADMIN")"

echo "== old stickers"
SCANS=$(sql "select count(*) from scan_events")
ok "an old bus.html?code= sticker can be peeked at" BUS "$(call POST "/buses/scan/$OLD" "" '{"peek":true}' >/dev/null; get "data['kind']")"
ok "without counting a scan" "$SCANS" "$(sql "select count(*) from scan_events")"

echo "== replacing a sticker"
ok "a crew account cannot replace it" 403 "$(call POST "/fleet/buses/$BUS/qr/rotate" "$CREW")"
ok "the owner replaces it" 201 "$(call POST "/fleet/buses/$BUS/qr/rotate" "$OWNER")"
NEW=$(get "data['code']")
ok "the new code is different" true "$([ -n "$NEW" ] && [ "$NEW" != "$OLD" ] && echo true || echo false)"
ok "the old code stops at once" 404 "$(call POST "/qr/r/$OLD" "" '{"refresh":true}')"
ok "the new one works" 201 "$(call POST "/qr/r/$NEW" "" '{"refresh":true}')"
ok "still one active code" 1 "$(sql "select count(*) from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"isActive\"")"
ok "the replacement is audited" 1 "$(sql "select count(*) from audit_events where action='qr.rotate' and \"createdAt\" >= '$START' and summary like '%$OLD%$NEW%'")"

echo "== archive and restore"
# Archiving takes the crew off the bus; remember who was on it so the clean-up puts them back.
CREW_ROWS=$(sql "select string_agg('''' || id || '''', ',') from driver_assignments where \"vehicleId\"='$BUS' and \"endedAt\" is null")
sql "update qr_codes set \"isActive\"=false where \"vehicleId\"='$BUS' and kind='BUS'" >/dev/null
ok "archive the bus" 200 "$(call PATCH "/fleet/buses/$BUS/archive" "$OWNER" '{"archived":true}')"
ok "restoring it" 200 "$(call PATCH "/fleet/buses/$BUS/archive" "$OWNER" '{"archived":false}')"
ok "gives it a working code again" 1 "$(sql "select count(*) from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"isActive\"")"
ok "archiving took the crew off it" 0 "$(sql "select count(*) from driver_assignments where \"vehicleId\"='$BUS' and \"endedAt\" is null")"
[ -n "$CREW_ROWS" ] && sql "update driver_assignments set \"endedAt\"=null where id in ($CREW_ROWS)" >/dev/null

echo "== clean up"
# Back to the sticker the bus had, so printed test stickers keep working.
sql "update qr_codes set \"isActive\"=false where \"vehicleId\"='$BUS' and kind='BUS';
     delete from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"createdAt\" >= '$START';
     update qr_codes set \"isActive\"=true, \"replacedAt\"=null where \"shortCode\"='$OLD';
     delete from qr_prints where \"createdAt\" >= '$START';" >/dev/null
ok "the bus has its original code back" "$OLD" "$(sql "select \"shortCode\" from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"isActive\"")"

finish
