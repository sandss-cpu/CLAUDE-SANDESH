#!/bin/bash
# Driver scorecards and appraisals (Phase 3, Feature 5 part two), against a running API:
# figures from a throwaway bus with known trips and fuel, the 10-review threshold, the
# owner-only leaderboard, the appraisal life cycle and its audit trail, crew disputes
# settled by a moderator, and a manager of one company getting 404 for another
# company's drivers, trips and appraisals. Everything it creates is removed.
#
#   bash scripts/appraisal_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: appraisal_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

id_of(){ sql "select id from $1 where $2 limit 1"; }
CID=$(id_of operators "slug like 'himalayan%'")
OTHER_CID=$(id_of operators "slug='shrestha-yatayat'")
GOPAL=$(id_of drivers "name='Gopal Shrestha'")
OTHER_TRIP=$(id_of trips "\"operatorId\"='$OTHER_CID'")
ROUTE=$(id_of routes "code='KTM-PKR'")
START=$(date -u +"%Y-%m-%d %H:%M:%S")
RUN="smoke_appr_$(date +%s)"
TODAY=$(TZ=Asia/Kathmandu date +%Y-%m-%d)
FROM=$(TZ=Asia/Kathmandu date -v-3d +%Y-%m-%d)

echo "== sign in"
OWNER=$(login owner.fleet@bato.test); MANAGER=$(login manager.fleet@bato.test)
CREW=$(login crew.fleet@bato.test); SINGLE=$(login owner.single@bato.test)
MOD=$(staff_login tester.moderator@bato.test)

echo "== a throwaway bus with two drivers, two trips and two full tanks"
B="{\"registrationNo\":\"ba 9 kha 8181\",\"label\":\"Appraisal Smoke Bus\",\"seatCount\":30,\"busType\":\"TOURIST_DELUXE\",\"odometerKm\":80000,\"routeId\":\"$ROUTE\"}"
ok "bus registered, on a route" 201 "$(call POST /fleet/companies/$CID/buses "$OWNER" "$B")"
BUS=$(get "data['id']")
ok "driver A added" 201 "$(call POST /fleet/companies/$CID/drivers "$MANAGER" '{"name":"Smoke Driver A","phone":"9800000101","role":"DRIVER"}')"
DA=$(get "data['id']")
ok "driver B added" 201 "$(call POST /fleet/companies/$CID/drivers "$MANAGER" '{"name":"Smoke Driver B","phone":"9800000102","role":"DRIVER"}')"
DB=$(get "data['id']")
B="{\"filledAt\":\"$(iso -144000)\",\"odometerKm\":80000,\"litres\":100,\"costNpr\":17800,\"fullTank\":true}"
ok "full tank at 80,000 km" 201 "$(call POST /fleet/buses/$BUS/fuel "$MANAGER" "$B")"
# A drives 300 km, B 200 km; then 125 L fills the tank: 500 km on 125 L = 4.0 km/l.
B="{\"direction\":\"FORWARD\",\"driverId\":\"$DA\",\"departAt\":\"$(iso -129600)\",\"startOdometerKm\":80000}"
ok "A's trip started (logged late)" 201 "$(call POST /fleet/buses/$BUS/trips "$MANAGER" "$B")"
TA=$(get "data['id']")
B="{\"arriveAt\":\"$(iso -108000)\",\"endOdometerKm\":80300}"
ok "A's trip ended at 80,300 km" 201 "$(call POST /fleet/trips/$TA/end "$MANAGER" "$B")"
B="{\"direction\":\"REVERSE\",\"driverId\":\"$DB\",\"departAt\":\"$(iso -100800)\",\"startOdometerKm\":80300}"
ok "B's trip started" 201 "$(call POST /fleet/buses/$BUS/trips "$MANAGER" "$B")"
TB=$(get "data['id']")
B="{\"arriveAt\":\"$(iso -79200)\",\"endOdometerKm\":80500}"
ok "B's trip ended at 80,500 km" 201 "$(call POST /fleet/trips/$TB/end "$MANAGER" "$B")"
B="{\"filledAt\":\"$(iso -75600)\",\"odometerKm\":80500,\"litres\":125,\"costNpr\":22250,\"fullTank\":true}"
ok "full tank again: 125 L" 201 "$(call POST /fleet/buses/$BUS/fuel "$MANAGER" "$B")"
# Ten passenger reviews on A's trip and two on B's, as the review route would have written them.
sql "insert into ride_feedback (id, \"vehicleId\", \"sessionId\", \"tripId\", \"driverId\", overall, driving, \"createdAt\")
     select gen_random_uuid()::text, '$BUS', '${RUN}_a' || g, '$TA', '$DA', 5, 5, now() - interval '30 hours' from generate_series(1, 10) g;
     insert into ride_feedback (id, \"vehicleId\", \"sessionId\", \"tripId\", \"driverId\", overall, driving, comment, \"createdAt\")
     select gen_random_uuid()::text, '$BUS', '${RUN}_b' || g, '$TB', '$DB', 4, 4, 'Very rash driving, overtaking on bends', now() - interval '21 hours' from generate_series(1, 2) g;" >/dev/null
DISPUTED=$(sql "select id from ride_feedback where \"sessionId\"='${RUN}_a1'")
sql "update ride_feedback set \"createdAt\" = now() - interval '21 hours' where id='$DISPUTED'" >/dev/null

echo "== scorecards"
Q="from=$FROM&to=$TODAY"
ok "the owner opens A's scorecard" 200 "$(call GET "/fleet/drivers/$DA/scorecard?$Q" "$OWNER")"
ok "one trip, 300 km" "1 300" "$(get "f\"{data['trips']['trips']} {data['trips']['km']}\"")"
ok "4 km/l on A's trip, as on the same bus" "4 4" "$(get "f\"{data['fuel']['kmPerLitre']} {data['fuel']['sameBusesKmPerLitre']}\"")"
ok "ten reviews: enough to judge" "10 true" "$(get "f\"{data['passengers']['reviews']} {str(data['passengers']['enough']).lower()}\"")"
ok "all ten from a logged trip" 10 "$(get "data['passengers']['fromTrips']")"
ok "dates shown in BS too" true "$(get "bool(data['period']['toBs'])")"
ok "a safety score is suggested from no accidents" 5 "$(get "data['suggestions']['safety']['value']")"
ok "the manager can open it" 200 "$(call GET "/fleet/drivers/$DA/scorecard?$Q" "$MANAGER")"
ok "B, with two reviews, is not judged" "Not enough reviews yet" "$(call GET "/fleet/drivers/$DB/scorecard?$Q" "$OWNER" >/dev/null; get "data['passengers']['label']")"
ok "B's complaints are themed" unsafe "$(get "data['comments']['complaints'][0]['key']")"
ok "a period that ends before it starts is refused" 400 "$(call GET "/fleet/drivers/$DA/scorecard?from=$TODAY&to=$FROM" "$OWNER")"
ok "a crew account cannot open scorecards" 403 "$(call GET "/fleet/drivers/$DA/scorecard" "$CREW")"
ok "another company: scorecard not found" 404 "$(call GET "/fleet/drivers/$DA/scorecard" "$SINGLE")"

echo "== leaderboard"
ok "the owner opens it" 200 "$(call GET "/fleet/companies/$CID/leaderboard?$Q" "$OWNER")"
ok "A is ranked" true "$(get "next(r for r in data['rows'] if r['driverId']=='$DA')['rank'] is not None")"
ok "B is listed but not ranked" None "$(get "next(r for r in data['rows'] if r['driverId']=='$DB')['rank']")"
ok "it says why" true "$(get "'fewer than 10 reviews' in data['caveat']")"
ok "a manager cannot see it" 403 "$(call GET "/fleet/companies/$CID/leaderboard" "$MANAGER")"
ok "another company cannot see it" 404 "$(call GET "/fleet/companies/$CID/leaderboard" "$SINGLE")"

echo "== appraisals"
B="{\"periodStart\":\"$FROM\",\"periodEnd\":\"$TODAY\"}"
ok "the manager starts one for A" 201 "$(call POST "/fleet/drivers/$DA/appraisals" "$MANAGER" "$B")"
AP=$(get "data['id']")
ok "it starts as a draft with suggested scores" "DRAFT 5" "$(get "f\"{data['status']} {data['scores']['safety']}\"")"
ok "it keeps what the data suggested" true "$(get "data['suggested']['summary']['trips']==1")"
ok "finalising with scores missing is refused" 400 "$(call POST "/fleet/appraisals/$AP/finalise" "$MANAGER")"
B='{"drivingScore":5,"punctualityScore":4,"conductScore":4,"safetyScore":5,"vehicleCareScore":4,"attendanceScore":3,"strengths":"Calm on the Mugling road; यात्रु सुरक्षित महसुस गर्छन्।","outcome":"COMMENDATION"}'
ok "the manager gives every score" 200 "$(call PATCH "/fleet/appraisals/$AP" "$MANAGER" "$B")"
ok "the average is worked out" 4.2 "$(get "data['average']")"
ok "a score of 6 is refused" 400 "$(call PATCH "/fleet/appraisals/$AP" "$MANAGER" '{"drivingScore":6}')"
ok "a crew account cannot read it" 403 "$(call GET "/fleet/appraisals/$AP" "$CREW")"
ok "the appraisal prints as a PDF" "200 application/pdf" "$(curl -s -o "$R" -w "%{http_code} %{content_type}" "$API/fleet/appraisals/$AP/pdf" -H "Authorization: Bearer $OWNER")"
ok "a real PDF" "%PDF-" "$(head -c 5 "$R")"
ok "finalised" 201 "$(call POST "/fleet/appraisals/$AP/finalise" "$MANAGER")"
ok "a final appraisal cannot be changed" 409 "$(call PATCH "/fleet/appraisals/$AP" "$OWNER" '{"comments":"later edit"}')"
ok "or deleted" 409 "$(call DELETE "/fleet/appraisals/$AP" "$OWNER")"
ok "discussed with the driver" 201 "$(call POST "/fleet/appraisals/$AP/acknowledge" "$MANAGER")"
ok "only once" 409 "$(call POST "/fleet/appraisals/$AP/acknowledge" "$MANAGER")"
ok "every step is audited" 4 "$(sql "select count(*) from audit_events where \"entityId\"='$AP' and action in ('appraisal.create','appraisal.update','appraisal.finalise','appraisal.acknowledge')")"
PERIOD="{\"periodStart\":\"$FROM\",\"periodEnd\":\"$TODAY\"}"
ok "a second draft" 201 "$(call POST "/fleet/drivers/$DA/appraisals" "$OWNER" "$PERIOD")"
AP2=$(get "data['id']")
ok "a draft can be deleted" 200 "$(call DELETE "/fleet/appraisals/$AP2" "$OWNER")"
ok "the deletion is audited" 1 "$(sql "select count(*) from audit_events where \"entityId\"='$AP2' and action='appraisal.delete'")"
ok "A's appraisals" 1 "$(call GET "/fleet/drivers/$DA/appraisals" "$OWNER" >/dev/null; get "len(data)")"
ok "the company's list has it" true "$(call GET "/fleet/companies/$CID/appraisals?status=FINAL" "$MANAGER" >/dev/null; get "any(a['id']=='$AP' for a in data)")"

echo "== another company's records: 404, never 403"
ok "its owner cannot read our appraisal" 404 "$(call GET "/fleet/appraisals/$AP" "$SINGLE")"
ok "or change it" 404 "$(call PATCH "/fleet/appraisals/$AP" "$SINGLE" '{"comments":"x"}')"
ok "or print it" 404 "$(call GET "/fleet/appraisals/$AP/pdf" "$SINGLE")"
ok "or appraise our driver" 404 "$(call POST "/fleet/drivers/$DA/appraisals" "$SINGLE" "$PERIOD")"
ok "or list our driver's appraisals" 404 "$(call GET "/fleet/drivers/$DA/appraisals" "$SINGLE")"
ok "the other company appraises its own driver" 201 "$(call POST "/fleet/drivers/$GOPAL/appraisals" "$SINGLE" "$PERIOD")"
OTHER_AP=$(get "data['id']")
ok "our manager: their appraisal not found" 404 "$(call GET "/fleet/appraisals/$OTHER_AP" "$MANAGER")"
ok "our manager: their driver's scorecard not found" 404 "$(call GET "/fleet/drivers/$GOPAL/scorecard" "$MANAGER")"
ok "our manager: their driver's appraisals not found" 404 "$(call GET "/fleet/drivers/$GOPAL/appraisals" "$MANAGER")"
ok "our manager: their trip not found" 404 "$(call GET "/fleet/trips/$OTHER_TRIP" "$MANAGER")"
ok "our manager: their appraisal list not found" 404 "$(call GET "/fleet/companies/$OTHER_CID/appraisals" "$MANAGER")"
ok "our manager: cannot change their driver" 404 "$(call PATCH "/fleet/drivers/$GOPAL" "$MANAGER" '{"name":"Gopal Shrestha","phone":"9856000011","role":"DRIVER"}')"
call DELETE "/fleet/appraisals/$OTHER_AP" "$SINGLE" >/dev/null

echo "== a review that names the wrong crew"
B="{\"targetType\":\"BUS_REVIEW\",\"targetId\":\"$DISPUTED\",\"reason\":\"WRONG_CREW\",\"sessionId\":\"${RUN}_reader\"}"
ok "a reader cannot claim the crew is wrong" 403 "$(call POST /moderation/report "" "$B")"
ok "the owner disputes it" 201 "$(call POST "/fleet/reviews/$DISPUTED/report" "$OWNER" '{"reason":"WRONG_CREW","detail":"B drove the return run"}')"
ok "the review stays live" APPROVED "$(sql "select moderation from ride_feedback where id='$DISPUTED'")"
ok "another company cannot dispute it" 404 "$(call POST "/fleet/reviews/$DISPUTED/report" "$SINGLE" '{"reason":"WRONG_CREW"}')"
ok "the moderator sees a crew dispute" true "$(call GET /moderation/reports "$MOD" >/dev/null; get "next(g for g in data if g['targetId']=='$DISPUTED')['wrongCrew']")"
ok "and which crew it names" "Smoke Driver A" "$(get "next(g for g in data if g['targetId']=='$DISPUTED')['preview']['crew']['driver']")"
ok "both of the bus's trips that day are offered" 2 "$(call GET "/moderation/bus-reviews/$DISPUTED/crew" "$MOD" >/dev/null; get "len([t for t in data['trips'] if t['id'] in ('$TA', '$TB')])")"
ok "the reviewer is not in it" false "$(get "'sessionId' in str(d) or 'userId' in str(d) or 'ipHash' in str(d)")"
B="{\"tripId\":\"$TB\",\"note\":\"Trip log: B drove the return run\"}"
ok "the owner cannot move it themselves" 403 "$(call POST "/moderation/bus-reviews/$DISPUTED/crew" "$OWNER" "$B")"
B2="{\"tripId\":\"$OTHER_TRIP\",\"note\":\"wrong bus\"}"
ok "a trip of another bus is refused" 400 "$(call POST "/moderation/bus-reviews/$DISPUTED/crew" "$MOD" "$B2")"
B2="{\"tripId\":\"$TB\"}"
ok "a note is required" 400 "$(call POST "/moderation/bus-reviews/$DISPUTED/crew" "$MOD" "$B2")"
ok "the moderator moves it to B's trip" 201 "$(call POST "/moderation/bus-reviews/$DISPUTED/crew" "$MOD" "$B")"
ok "it now names B" "$DB $TB" "$(sql "select \"driverId\" || ' ' || \"tripId\" from ride_feedback where id='$DISPUTED'")"
ok "its stars are untouched" 5 "$(sql "select overall from ride_feedback where id='$DISPUTED'")"
ok "the dispute is closed" ACTIONED "$(sql "select status from reports where \"targetId\"='$DISPUTED' and reason='WRONG_CREW'")"
ok "logged for moderation and audit" "1 1" "$(echo "$(sql "select count(*) from moderation_entries where \"targetId\"='$DISPUTED' and action='REASSIGN_CREW'") $(sql "select count(*) from audit_events where \"entityId\"='$DISPUTED' and action='review.crew'")")"
ok "A drops to nine reviews: no longer judged" "9 false" "$(call GET "/fleet/drivers/$DA/scorecard?$Q" "$OWNER" >/dev/null; get "f\"{data['passengers']['reviews']} {str(data['passengers']['enough']).lower()}\"")"
ok "it can also go to nobody" 201 "$(call POST "/moderation/bus-reviews/$DISPUTED/crew" "$MOD" '{"tripId":null,"note":"Nobody can tell"}')"
ok "crew unknown" "||" "$(sql "select coalesce(\"driverId\",'') || '|' || coalesce(\"conductorId\",'') || '|' || coalesce(\"tripId\",'') from ride_feedback where id='$DISPUTED'")"

echo "== clean up"
sql "delete from reports where \"targetId\" in (select id from ride_feedback where \"sessionId\" like '${RUN}%') or \"sessionId\" like '${RUN}%';
     delete from moderation_entries where \"targetId\" in (select id from ride_feedback where \"sessionId\" like '${RUN}%');
     delete from ride_feedback where \"sessionId\" like '${RUN}%';" >/dev/null
call PATCH "/fleet/buses/$BUS/archive" "$OWNER" '{"archived":true}' >/dev/null
ok "throwaway bus deleted" 200 "$(call DELETE "/fleet/buses/$BUS" "$OWNER")"
sql "delete from drivers where id in ('$DA', '$DB');" >/dev/null
ok "nothing left behind" "0 0 0 0" "$(echo "$(sql "select count(*) from drivers where name like 'Smoke Driver%'") $(sql "select count(*) from driver_appraisals where \"createdAt\" >= '$START'") $(sql "select count(*) from trips where id in ('$TA','$TB')") $(sql "select count(*) from vehicles where \"plateKey\"='BA9KHA8181'")")"

finish
