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
EDITOR_ID=$(id_of users "email='tester.editor@bato.test'")
# Whatever editors have programmed on this route and its two test buses is put aside and
# restored exactly at the end, so the checks start from the route's both-way list alone.
MINE="\"routeId\"='$PKR' or \"vehicleId\" in ('$BUS1','$BUS2')"
SNAPSHOT=$(sql "select coalesce(json_agg(p), '[]') from content_placements p where $MINE")
BEFORE_COUNT=$(sql "select count(*) from content_placements where $MINE")
sql "delete from content_placements where (\"routeId\"='$PKR' and direction <> 'BOTH') or \"vehicleId\" in ('$BUS1','$BUS2')" >/dev/null

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

echo "== adding and editing routes"
RCODE="SMK-$(date +%s | tail -c 6)"; RNAME="Smoketown – Testpur $RCODE"
B="{\"code\":\"$RCODE\",\"name\":\"$RNAME\",\"startPlace\":\"Smoketown\",\"endPlace\":\"Testpur\"}"
ok "moderator cannot add a route" 403 "$(call POST /programming/routes "$MOD" "$B")"
ok "bus owner cannot add a route" 403 "$(call POST /programming/routes "$OWNER" "$B")"
ok "the old unaudited route endpoint is gone" 404 "$(call POST /operators/routes "$EDITOR" "$B")"
LOWER=$(echo "$RCODE" | tr 'A-Z' 'a-z')
B="{\"code\":\" $LOWER \",\"name\":\"$RNAME\",\"nameNe\":\"\",\"startPlace\":\"Smoketown\",\"endPlace\":\"Testpur\",\"distanceKm\":\"120\",\"typicalHours\":4.5,\"description\":\"\"}"
ok "an editor adds a route" 201 "$(call POST /programming/routes "$EDITOR" "$B")"
RID=$(get "data['id']")
ok "its code is tidied to capitals" "$RCODE" "$(get "data['code']")"
ok "empty optional fields are stored empty" "None|None|120|4.5" "$(get "f\"{data['nameNe']}|{data['description']}|{data['distanceKm']}|{data['typicalHours']}\"")"
ok "it is in every route list at once" true "$(call GET /operators/routes "" >/dev/null; get "any(r['code']=='$RCODE' for r in data)")"
ok "the same code twice is refused" 409 "$(call POST /programming/routes "$EDITOR" "$B")"
ok "and the reason names the route" true "$(get "'$RCODE' in d['message']")"
B="{\"code\":\"$RCODE-2\",\"name\":\"$(echo "$RNAME" | tr 'a-z' 'A-Z')\",\"startPlace\":\"Smoketown\",\"endPlace\":\"Testpur\"}"
ok "the same name in other capitals is refused" 409 "$(call POST /programming/routes "$EDITOR" "$B")"
B="{\"code\":\"$RCODE-3\",\"name\":\"Round trip $RCODE\",\"startPlace\":\"Testpur\",\"endPlace\":\" testpur \"}"
ok "a route needs two different places" 400 "$(call POST /programming/routes "$EDITOR" "$B")"
B="{\"code\":\"KTM_PKR!\",\"name\":\"Bad code $RCODE\",\"startPlace\":\"A town\",\"endPlace\":\"B town\"}"
ok "a code with other characters is refused" 400 "$(call POST /programming/routes "$EDITOR" "$B")"
B="{\"code\":\"$RCODE-4\",\"name\":\"Zero km $RCODE\",\"startPlace\":\"A town\",\"endPlace\":\"B town\",\"distanceKm\":0}"
ok "a distance of 0 km is refused" 400 "$(call POST /programming/routes "$EDITOR" "$B")"
B="{\"code\":\"$RCODE\",\"name\":\"Smoketown – Newpur $RCODE\",\"startPlace\":\"Smoketown\",\"endPlace\":\"Newpur\",\"distanceKm\":null,\"typicalHours\":\"\"}"
ok "moderator cannot edit a route" 403 "$(call PATCH "/programming/routes/$RID" "$MOD" "$B")"
ok "an editor edits it" 200 "$(call PATCH "/programming/routes/$RID" "$EDITOR" "$B")"
ok "the edit is saved and cleared fields are empty" "Newpur|None|None" "$(get "f\"{data['endPlace']}|{data['distanceKm']}|{data['typicalHours']}\"")"
B="{\"code\":\"KTM-PKR\",\"name\":\"Smoketown – Newpur $RCODE\",\"startPlace\":\"Smoketown\",\"endPlace\":\"Newpur\"}"
ok "another route's code is refused on an edit" 409 "$(call PATCH "/programming/routes/$RID" "$EDITOR" "$B")"
ok "editing a route that does not exist" 404 "$(call PATCH /programming/routes/00000000-0000-4000-8000-000000000000 "$EDITOR" "$B")"
call GET "/programming/history?routeId=$RID" "$MOD" >/dev/null
ok "the route's changes show who added and renamed it" "Added|Renamed" "$(get "'|'.join(e['summary'].split()[0] for e in reversed(data))")"
ok "both are in the audit log" 2 "$(sql "select count(*) from audit_events where \"entityType\"='Route' and \"entityId\"='$RID'")"
sql "delete from audit_events where \"entityType\"='Route' and \"entityId\"='$RID'; delete from routes where id='$RID'" >/dev/null

echo "== briefer articles: a summary and key points before publishing"
B='{"title":"Smoke brief article","body":"## A heading\n\nThe first sentence of a smoke test article. A second sentence follows it."}'
ok "an editor drafts an article with no brief" 201 "$(call POST /magazine/articles "$EDITOR" "$B")"
SMOKE_ART=$(get "data['id']")
ok "it cannot be published without a summary" 400 "$(call PATCH "/magazine/articles/$SMOKE_ART/publish" "$EDITOR")"
ok "the reason is given" true "$(get "'summary' in d['message']")"
ok "a summary over 160 characters is refused" 400 "$(call PATCH "/magazine/articles/$SMOKE_ART" "$EDITOR" "{\"summary\":\"$(printf 'x%.0s' $(seq 1 161))\"}")"
ok "the summary is saved on the draft" 200 "$(call PATCH "/magazine/articles/$SMOKE_ART" "$EDITOR" '{"summary":"A smoke test, in one line."}')"
ok "a summary alone is not enough to publish" 400 "$(call PATCH "/magazine/articles/$SMOKE_ART" "$EDITOR" '{"status":"PUBLISHED"}')"
ok "four key points are refused" 400 "$(call PATCH "/magazine/articles/$SMOKE_ART" "$EDITOR" '{"keyPoints":["a","b","c","d"]}')"
ok "with key points it publishes" 200 "$(call PATCH "/magazine/articles/$SMOKE_ART" "$EDITOR" '{"keyPoints":["First point"," ","Second point"],"status":"PUBLISHED"}')"
ok "blank points are dropped" '["First point", "Second point"]' "$(get "str(data['keyPoints']).replace(chr(39), chr(34))")"
SLUG=$(get "data['slug']")
ok "readers see the brief" "A smoke test, in one line.|2" "$(call GET "/magazine/articles/$SLUG" "" >/dev/null; get "data['summary'] + '|' + str(len(data['keyPoints']))")"
ok "cards carry the summary" true "$(call GET "/magazine/articles?q=Smoke%20brief" "" >/dev/null; get "any(a.get('summary')=='A smoke test, in one line.' for a in data['items'])")"
sql "delete from articles where id='$SMOKE_ART'" >/dev/null

echo "== clean up"
# Only what the test editor made during this run: a time window alone also caught rows
# whose timestamps were written in another zone.
sql "delete from content_placements where \"createdAt\" >= '$START' and \"createdById\" = '$EDITOR_ID';
     delete from route_notices where \"createdAt\" >= '$START' and \"createdById\" = '$EDITOR_ID';
     update vehicles set \"routeId\" = '$PKR' where id = '$BUS1';
     delete from content_placements where $MINE;
     insert into content_placements select * from json_populate_recordset(null::content_placements, \$snap\$$SNAPSHOT\$snap\$);" >/dev/null
ok "the route's programme is back as it was" "$BEFORE_COUNT" "$(sql "select count(*) from content_placements where $MINE")"

finish
