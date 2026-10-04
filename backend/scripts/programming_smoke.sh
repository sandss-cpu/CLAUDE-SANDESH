#!/bin/bash
# Route programming checks (Phase 3, Feature 1): who may change what each bus shows,
# direction, bus overrides, schedules, a bus moved to another route, notices, history.
# Everything it adds is removed at the end, and the route's own list is put back.
#
#   bash scripts/programming_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: programming_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

id_of(){ sql "select id from $1 where $2 limit 1"; }
code_of(){ sql "select q.\"shortCode\" from qr_codes q join vehicles v on v.id=q.\"vehicleId\" where v.\"plateKey\"='$1' and q.kind='BUS' and q.\"isActive\" limit 1"; }
scan(){ # code [direction] -> leaves the resolve answer in $R
  local body="{\"sessionId\":\"smoke_prog\",\"refresh\":true${2:+,\"direction\":\"$2\"}}"
  call POST "/qr/r/$1" "" "$body"
}
lead(){ scan "$1" "$2" >/dev/null; get "data['routeArticles'][0]['slug']"; }

PKR=$(id_of routes "code='KTM-PKR'"); CTN=$(id_of routes "code='KTM-CTN'"); LMB=$(id_of routes "code='KTM-LMB'")
BANDIPUR=$(id_of articles "slug='bandipur-the-town-time-forgot'")
NIGHTBUS=$(id_of articles "slug='first-time-on-a-night-bus'")
CABLECAR=$(id_of articles "slug='manakamana-cable-car'")
JOMSOM=$(id_of articles "slug='jomsom-wind'")
BUS1=$(id_of vehicles "\"plateKey\"='BA1KHA2345'"); BUS2=$(id_of vehicles "\"plateKey\"='BA1KHA2346'")
QR1=$(code_of BA1KHA2345); QR2=$(code_of BA1KHA2346)
START=$(date -u +"%Y-%m-%d %H:%M:%S")
# The route's own list, put back exactly at the end.
EDITOR_ID=$(id_of users "email='tester.editor@bato.test'")
BEFORE_COUNT=$(sql "select count(*) from content_placements where \"routeId\"='$PKR'")
BEFORE_ORDER=$(sql "select string_agg(format('update content_placements set position=%s where id=%L;', position, id), ' ') from content_placements where \"routeId\"='$PKR'")

echo "== sign in"
EDITOR=$(staff_login tester.editor@bato.test); MOD=$(staff_login tester.moderator@bato.test)
OWNER=$(login owner.fleet@bato.test)
ok "editor signed in" yes "$([ ${#EDITOR} -gt 40 ] && echo yes || echo no)"
ok "moderator signed in" yes "$([ ${#MOD} -gt 40 ] && echo yes || echo no)"

echo "== who may change programming"
ok "moderator can read a route's list" 200 "$(call GET "/programming/placements?routeId=$PKR&direction=BOTH" "$MOD")"
B="{\"articleId\":\"$BANDIPUR\",\"routeId\":\"$PKR\",\"direction\":\"FORWARD\"}"
ok "moderator cannot add" 403 "$(call POST /programming/placements "$MOD" "$B")"
ok "bus owner cannot add" 403 "$(call POST /programming/placements "$OWNER" "$B")"
ok "signed out cannot read" 401 "$(call GET "/programming/placements?routeId=$PKR" "")"
B="{\"articleId\":\"$BANDIPUR\",\"direction\":\"FORWARD\"}"
ok "the every-bus list has no direction" 400 "$(call POST /programming/placements "$EDITOR" "$B")"

echo "== each direction its own lead"
B="{\"articleId\":\"$BANDIPUR\",\"routeId\":\"$PKR\",\"direction\":\"FORWARD\",\"isPinned\":true}"
ok "pin a lead for the way to Pokhara" 201 "$(call POST /programming/placements "$EDITOR" "$B")"
B="{\"articleId\":\"$NIGHTBUS\",\"routeId\":\"$PKR\",\"direction\":\"REVERSE\",\"isPinned\":true}"
ok "pin a lead for the way to Kathmandu" 201 "$(call POST /programming/placements "$EDITOR" "$B")"
ok "the same story twice in one list is refused" 409 "$(call POST /programming/placements "$EDITOR" "$B")"
ok "bus 1 heading to Pokhara leads with Bandipur" bandipur-the-town-time-forgot "$(lead "$QR1" FORWARD)"
ok "bus 2 heading to Kathmandu leads with the night bus" first-time-on-a-night-bus "$(lead "$QR2" REVERSE)"
ok "the way-to-Kathmandu story is not shown towards Pokhara" false \
  "$(scan "$QR1" FORWARD >/dev/null; get "any(a['slug']=='first-time-on-a-night-bus' and a['level']=='ROUTE_DIRECTION' for a in data['routeArticles'])")"
ok "with no direction, only both-way stories" true \
  "$(scan "$QR1" >/dev/null; get "all(a['level'] in ('ROUTE_BOTH','DEFAULT') for a in data['routeArticles'])")"

echo "== a bus override beats the route"
B="{\"articleId\":\"$CABLECAR\",\"vehicleId\":\"$BUS1\",\"isPinned\":true}"
ok "pin a story on bus 1 only" 201 "$(call POST /programming/placements "$EDITOR" "$B")"; OVERRIDE=$(get "data['id']")
ok "bus 1 now leads with it" manakamana-cable-car "$(lead "$QR1" FORWARD)"
ok "bus 2 still leads with the route's story" bandipur-the-town-time-forgot "$(lead "$QR2" FORWARD)"
ok "remove the override" 200 "$(call DELETE "/programming/placements/$OVERRIDE" "$EDITOR")"
ok "bus 1 is back on the route's lead" bandipur-the-town-time-forgot "$(lead "$QR1" FORWARD)"

echo "== schedules (Asia/Kathmandu)"
B="{\"articleId\":\"$JOMSOM\",\"routeId\":\"$PKR\",\"startsAt\":\"$(iso 4)\",\"endsAt\":\"$(iso 9)\"}"
ok "schedule a story for a few seconds' time" 201 "$(call POST /programming/placements "$EDITOR" "$B")"
# The current issue fills every shelf at DEFAULT level, so the scheduled placement is told apart by its level.
has_jomsom(){ scan "$QR2" >/dev/null; get "any(a['slug']=='jomsom-wind' and a['level']=='ROUTE_BOTH' for a in data['routeArticles'] + data['moreArticles'])"; }
ok "not shown before it starts" false "$(has_jomsom)"
sleep 5
ok "shown once it has started" true "$(has_jomsom)"
sleep 5
ok "gone once it has ended" false "$(has_jomsom)"
B="{\"articleId\":\"$JOMSOM\",\"routeId\":\"$PKR\",\"direction\":\"FORWARD\",\"timeFrom\":\"22:00\",\"timeTo\":\"02:00\"}"
ok "a night-bus window" 201 "$(call POST /programming/placements "$EDITOR" "$B")"; NIGHT=$(get "data['id']")
in_preview(){ call GET "/programming/preview?routeId=$PKR&direction=FORWARD&at=$1" "$EDITOR" >/dev/null; get "any(p['article']['slug']=='jomsom-wind' and p['level']=='ROUTE_DIRECTION' for p in [data['lead']] + data['stories'] + data['more'] if p)"; }
ok "previewed at 23:00 in Kathmandu it shows" true "$(in_preview 2026-10-09T17:15:00.000Z)"
ok "previewed at 01:00 the next morning it still shows" true "$(in_preview 2026-10-09T19:15:00.000Z)"
ok "previewed at 10:00 it does not" false "$(in_preview 2026-10-10T04:15:00.000Z)"
B='{"timeTo":null}'
ok "half a daily window is refused" 400 "$(call PATCH "/programming/placements/$NIGHT" "$EDITOR" "$B")"

echo "== preview matches the bus"
call GET "/programming/preview?vehicleId=$BUS2&direction=REVERSE" "$EDITOR" >/dev/null
ok "preview for bus 2 leads with what bus 2 shows" first-time-on-a-night-bus "$(get "data['lead']['article']['slug']")"

echo "== moving a bus to another route, without reprinting"
B="{\"routeId\":\"$CTN\"}"
ok "owner moves bus 1 to Kathmandu–Chitwan" 200 "$(call PATCH "/fleet/buses/$BUS1" "$OWNER" "$B")"
ok "its existing QR now shows that route" KTM-CTN "$(scan "$QR1" >/dev/null; get "data['route']['code']")"
ok "and that route's stories" true "$(get "any(a['slug']=='chitwan-in-three-days' for a in data['routeArticles'])")"
B="{\"routeId\":\"$PKR\"}"
ok "owner moves it back" 200 "$(call PATCH "/fleet/buses/$BUS1" "$OWNER" "$B")"

echo "== notices"
B="{\"routeId\":\"$PKR\",\"direction\":\"REVERSE\",\"severity\":\"DANGER\",\"title\":\"Landslide near Mugling: expect delays\"}"
ok "post a notice for the way to Kathmandu" 201 "$(call POST /programming/notices "$EDITOR" "$B")"; NOTICE=$(get "data['id']")
ok "shown heading to Kathmandu" DANGER "$(scan "$QR2" REVERSE >/dev/null; get "data['notices'][0]['severity']")"
ok "not shown heading to Pokhara" 0 "$(scan "$QR2" FORWARD >/dev/null; get "len(data['notices'])")"
ok "moderator cannot post one" 403 "$(call POST /programming/notices "$MOD" "$B")"
ok "remove the notice" 200 "$(call DELETE "/programming/notices/$NOTICE" "$EDITOR")"

echo "== copy, assign, reorder"
B="{\"routeId\":\"$PKR\",\"from\":\"FORWARD\"}"
ok "copy the way-to-Pokhara list to the return" 201 "$(call POST /programming/copy-direction "$EDITOR" "$B")"
ok "copies what the return list lacks" true "$(get "data['copied']>=1")"
B="{\"articleId\":\"$JOMSOM\",\"routeIds\":[\"$CTN\",\"$LMB\"]}"
ok "put one story on two routes" 201 "$(call POST /programming/assign "$EDITOR" "$B")"
ok "both routes get it" 2 "$(get "data['added']")"
call GET "/programming/placements?routeId=$PKR&direction=BOTH" "$EDITOR" >/dev/null
ORDER=$(get "','.join(reversed([p['id'] for p in data['items']]))")
B="{\"ids\":[\"$(echo "$ORDER" | sed 's/,/","/g')\"]}"
ok "reorder the both-ways list" 201 "$(call POST /programming/placements/reorder "$EDITOR" "$B")"
ok "the list comes back in the new order" "$ORDER" "$(call GET "/programming/placements?routeId=$PKR&direction=BOTH" "$EDITOR" >/dev/null; get "','.join(p['id'] for p in data['items'])")"

echo "== history"
call GET "/programming/history?routeId=$PKR" "$MOD" >/dev/null
ok "moderator can read the history" true "$(get "len(data)>=8")"
ok "each change names who made it" true "$(get "all(e['actor'] and e['actor']['name'] for e in data[:8])")"

echo "== clean up"
# Only what the test editor made during this run: a time window alone also caught rows
# whose timestamps were written in another zone.
sql "delete from content_placements where \"createdAt\" >= '$START' and \"createdById\" = '$EDITOR_ID';
     delete from route_notices where \"createdAt\" >= '$START' and \"createdById\" = '$EDITOR_ID';
     update vehicles set \"routeId\" = '$PKR' where id = '$BUS1';
     $BEFORE_ORDER" >/dev/null
ok "the route's own list is back as it was" "$BEFORE_COUNT" "$(sql "select count(*) from content_placements where \"routeId\"='$PKR'")"

finish
