#!/bin/bash
# Duty log checks (Phase 3, Feature 5): who may log trips, two drivers on one bus in one
# day with each review landing on the right one, the bus's roster as the default crew,
# the 48-hour lock and the owner's reopening, and another company getting 404 throughout.
# Trips and reviews it makes are removed at the end, and the bus's odometer put back.
#
#   bash scripts/trips_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: trips_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

id_of(){ sql "select id from $1 where $2 limit 1"; }
CID=$(id_of operators "slug like 'himalayan%'")
BUS=$(id_of vehicles "\"plateKey\"='BA1KHA2345'")
QR=$(sql "select \"shortCode\" from qr_codes where \"vehicleId\"='$BUS' and kind='BUS' and \"isActive\" limit 1")
RAM=$(id_of drivers "name='Ram Bahadur Thapa'"); SUMAN=$(id_of drivers "name='Suman Rai'")
DEEPAK=$(id_of drivers "name='Deepak Shrestha'")
ODOMETER=$(sql "select \"odometerKm\" from vehicles where id='$BUS'")
START=$(date -u +"%Y-%m-%d %H:%M:%S")
TODAY=$(TZ=Asia/Kathmandu date +%Y-%m-%d)
RUN="smoke_trip_$(date +%s)"

# Nothing left running on the test bus from an earlier, interrupted run.
sql "update trips set status='CANCELLED' where \"vehicleId\"='$BUS' and status='IN_PROGRESS'" >/dev/null

review(){ # session overall -> HTTP status; review id in $R
  call POST "/buses/scan/$QR" "" "{\"sessionId\":\"$1\"}" >/dev/null
  local token; token=$(get "data['scanToken']")
  local body="{\"overall\":$2,\"driving\":$2,\"sessionId\":\"$1\",\"scanToken\":\"$token\"}"
  call POST "/buses/$BUS/reviews" "" "$body"
}

echo "== who may log trips"
CREW=$(login crew.fleet@bato.test); OWNER=$(login owner.fleet@bato.test)
MANAGER=$(login manager.fleet@bato.test); SINGLE=$(login owner.single@bato.test)
ok "crew signed in without an authenticator" yes "$([ ${#CREW} -gt 40 ] && echo yes || echo no)"
ok "crew sees its company, as crew" CREW "$(call GET /fleet/companies "$CREW" >/dev/null; get "data[0]['role']")"
ok "crew opens the duty screen" 200 "$(call GET "/fleet/companies/$CID/duty" "$CREW")"
ok "the duty screen lists the company's buses" true "$(get "any(b['id']=='$BUS' for b in data['buses'])")"
ok "crew cannot open the dashboard" 403 "$(call GET "/fleet/companies/$CID/dashboard" "$CREW")"
ok "crew cannot list trips" 403 "$(call GET "/fleet/companies/$CID/trips" "$CREW")"
ok "crew cannot read reviews" 403 "$(call GET "/fleet/companies/$CID/reviews" "$CREW")"
B="{\"filledAt\":\"$(iso -3600)\",\"odometerKm\":$((ODOMETER + 1)),\"litres\":10,\"costNpr\":1780}"
ok "crew cannot record fuel" 403 "$(call POST "/fleet/buses/$BUS/fuel" "$CREW" "$B")"
ok "crew cannot add team members" 403 "$(call POST "/fleet/companies/$CID/members" "$CREW" '{"email":"x@bato.test","role":"MANAGER"}')"
ok "another company: duty screen not found" 404 "$(call GET "/fleet/companies/$CID/duty" "$SINGLE")"
ok "another company: cannot start a trip" 404 "$(call POST "/fleet/buses/$BUS/trips" "$SINGLE" '{"direction":"FORWARD"}')"
ok "another company: trip list not found" 404 "$(call GET "/fleet/companies/$CID/trips" "$SINGLE")"
ok "a direction is required" 400 "$(call POST "/fleet/buses/$BUS/trips" "$CREW" '{}')"

echo "== two drivers on one bus in one day"
B="{\"direction\":\"FORWARD\",\"driverId\":\"$RAM\",\"departAt\":\"$(iso -7200)\"}"
ok "crew starts the morning run with Ram" 201 "$(call POST "/fleet/buses/$BUS/trips" "$CREW" "$B")"
T1=$(get "data['id']")
ok "crew chosen by hand is marked so" MANUAL "$(get "data['source']")"
ok "a second trip while one runs is refused" 409 "$(call POST "/fleet/buses/$BUS/trips" "$CREW" "$B")"
ok "the scan follows the trip's direction" "FORWARD TRIP" \
  "$(call POST "/qr/r/$QR" "" '{"refresh":true}' >/dev/null; get "data['direction'] + ' ' + data['directionSource']")"
ok "a passenger reviews the morning run" 201 "$(review "${RUN}_1" 4)"; R1=$(get "data['id']")
ok "crew ends the morning run" 201 "$(call POST "/fleet/trips/$T1/end" "$CREW" '{}')"
ok "an ended trip cannot end again" 400 "$(call POST "/fleet/trips/$T1/end" "$CREW" '{}')"
B="{\"direction\":\"REVERSE\",\"driverId\":\"$SUMAN\"}"
ok "crew starts the afternoon run with Suman" 201 "$(call POST "/fleet/buses/$BUS/trips" "$CREW" "$B")"
T2=$(get "data['id']")
sleep 1
ok "a passenger reviews the afternoon run" 201 "$(review "${RUN}_2" 2)"; R2=$(get "data['id']")
ok "the morning review is Ram's, on the morning trip" "$RAM|$T1" "$(sql "select \"driverId\"||'|'||\"tripId\" from ride_feedback where id='$R1'")"
ok "the afternoon review is Suman's, on the afternoon trip" "$SUMAN|$T2" "$(sql "select \"driverId\"||'|'||\"tripId\" from ride_feedback where id='$R2'")"
call GET "/fleet/companies/$CID/reviews?driverId=$RAM" "$OWNER" >/dev/null
ok "the owner sees the morning review against Ram" "Ram Bahadur Thapa" "$(get "[r['crew']['driver']['name'] for r in data['items'] if r['id']=='$R1'][0]")"
ok "and not the afternoon one" false "$(get "any(r['id']=='$R2' for r in data['items'])")"
ok "the passenger is never named" false "$(get "any(k in r for r in data['items'] for k in ('userId','sessionId','ipHash'))")"

echo "== the bus's roster as the default crew"
ok "crew ends the afternoon run" 201 "$(call POST "/fleet/trips/$T2/end" "$CREW" '{}')"
B="{\"direction\":\"FORWARD\",\"startOdometerKm\":$((ODOMETER + 10))}"
ok "with nobody chosen, a trip still starts" 201 "$(call POST "/fleet/buses/$BUS/trips" "$CREW" "$B")"
T3=$(get "data['id']")
ok "and takes the crew assigned to the bus" "ASSIGNMENT_DEFAULT Ram Bahadur Thapa Deepak Shrestha" \
  "$(get "data['source'] + ' ' + data['driver']['name'] + ' ' + data['conductor']['name']")"
ok "an arrival reading below the departure one is refused" 400 "$(call POST "/fleet/trips/$T3/end" "$CREW" "{\"endOdometerKm\":$ODOMETER}")"
ok "ending with a reading" 201 "$(call POST "/fleet/trips/$T3/end" "$CREW" "{\"endOdometerKm\":$((ODOMETER + 210))}")"
ok "moves the bus's odometer on" $((ODOMETER + 210)) "$(sql "select \"odometerKm\" from vehicles where id='$BUS'")"
ok "and gives the trip's distance" 200 "$(call GET "/fleet/trips/$T3" "$OWNER" >/dev/null; get "data['km']")"
ok "clearing a reading stores nothing, not zero" None "$(call PATCH "/fleet/trips/$T3" "$MANAGER" '{"startOdometerKm":""}' >/dev/null; get "data['startOdometerKm']")"

echo "== corrections and the 48-hour lock"
B="{\"departAt\":\"$(iso -7300)\"}"
ok "the manager corrects the morning departure" 200 "$(call PATCH "/fleet/trips/$T1" "$MANAGER" "$B")"
B="{\"departAt\":\"$(iso -259200)\",\"arriveAt\":\"$(iso -252000)\"}"
ok "the manager moves it three days back" 200 "$(call PATCH "/fleet/trips/$T1" "$MANAGER" "$B")"
ok "so it is locked" true "$(get "data['locked']")"
ok "the manager cannot change a locked trip" 403 "$(call PATCH "/fleet/trips/$T1" "$MANAGER" "{\"conductorId\":\"$DEEPAK\"}")"
ok "the manager cannot reopen it" 403 "$(call POST "/fleet/trips/$T1/unlock" "$MANAGER" '{"reason":"Driver swapped at Mugling"}')"
ok "the owner must say why" 400 "$(call POST "/fleet/trips/$T1/unlock" "$OWNER" '{}')"
ok "the owner reopens it, with a reason" 201 "$(call POST "/fleet/trips/$T1/unlock" "$OWNER" '{"reason":"Driver swapped at Mugling"}')"
ok "the manager can correct it again" 200 "$(call PATCH "/fleet/trips/$T1" "$MANAGER" "{\"conductorId\":\"$DEEPAK\"}")"
ok "the reopening is in the audit trail" 1 "$(sql "select count(*) from audit_events where action='trip.unlock' and \"entityId\"='$T1'")"
ok "crew cannot correct trips" 403 "$(call PATCH "/fleet/trips/$T2" "$CREW" '{"direction":"FORWARD"}')"
ok "another company cannot read a trip" 404 "$(call GET "/fleet/trips/$T1" "$SINGLE")"
ok "another company cannot end one" 404 "$(call POST "/fleet/trips/$T2/end" "$SINGLE" '{}')"
ok "another company cannot correct one" 404 "$(call PATCH "/fleet/trips/$T2" "$SINGLE" '{"direction":"FORWARD"}')"
ok "another company cannot reopen one" 404 "$(call POST "/fleet/trips/$T1/unlock" "$SINGLE" '{"reason":"Not ours at all"}')"
ok "today's trips on the owner's list" 2 "$(call GET "/fleet/companies/$CID/trips?from=$TODAY&to=$TODAY&vehicleId=$BUS" "$OWNER" >/dev/null; get "len([t for t in data['items'] if t['id'] in ('$T2','$T3')])")"

echo "== clean up"
sql "delete from ride_feedback where \"sessionId\" like '${RUN}%';
     delete from fleet_notifications where \"dedupeKey\" in ('review:$R1', 'review:$R2');
     delete from scan_events where \"sessionId\" like '${RUN}%';
     delete from trips where id in ('$T1', '$T2', '$T3');
     update vehicles set \"odometerKm\" = $ODOMETER where id = '$BUS';" >/dev/null
ok "no test trips left" 0 "$(sql "select count(*) from trips where \"vehicleId\"='$BUS' and \"createdAt\" >= '$START'")"

finish
