#!/bin/bash
# Events and story submissions (October 2026), against a running API and website:
# who may manage events, what the website shows of them (drafts never, cancelled ones
# marked), their calendar files and search data; and a story sent from "Write a trip",
# confirmed by email, then featured as a magazine draft or declined by an editor; and
# creators on the website (editors choose them; delayed posts and hidden locations stay
# hidden, in the app and on the website).
# Everything it creates is removed at the end.
#
#   bash scripts/website_content_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: website_content_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

KEY=$(sed -n 's/^SITE_API_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$SMOKE_DIR/../.env")
SITE=$(sed -n 's/^SITE_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$SMOKE_DIR/../.env"); SITE=${SITE:-http://localhost:4000}
STAMP=$(date +%s)
START=$(date -u +"%Y-%m-%d %H:%M:%S")
site(){ # method path [json] [key]: posts as the website's own server does
  local args=(-s -o "$R" -w "%{http_code}" -X "$1" "$API$2" -H 'Content-Type: application/json' -H "x-site-client-ip: 203.0.113.9")
  [ -n "$4" ] && args+=(-H "x-site-key: $4")
  [ -n "$3" ] && args+=(-d "$3")
  curl "${args[@]}"
}
page(){ curl -s -o "$R" -w "%{http_code}" "$SITE$1"; }
has(){ grep -c -F -- "$1" "$R" | tr -d ' '; }
# Kathmandu time, n days from now, as UTC ISO: "day 3 at 18:00" in Nepal.
npt(){ python3 -c "import datetime as d,sys; n=d.datetime.utcnow()+d.timedelta(hours=5,minutes=45); t=(n+d.timedelta(days=int(sys.argv[1]))).replace(hour=int(sys.argv[2]),minute=0,second=0,microsecond=0); print((t-d.timedelta(hours=5,minutes=45)).strftime('%Y-%m-%dT%H:%M:00.000Z'))" "$1" "$2"; }
CITY="Smoketown$STAMP"
cleanup(){
  sql "delete from audit_events where \"entityType\" in ('Event','StorySubmission') and \"createdAt\" >= '$START';
       delete from events where city like 'Smoketown%' or title like 'Smoke % $STAMP';
       delete from articles where id in (select \"articleId\" from story_submissions where title like 'Smoke story $STAMP%');
       delete from story_submissions where title like 'Smoke story $STAMP%';
       delete from email_tokens where \"userId\" in (select id from users where email like 'smoke-writer-$STAMP%');
       delete from users where email like 'smoke-writer-$STAMP%';" >/dev/null
  # The demo creator and their account, as they were.
  [ -n "${C_ID:-}" ] && sql "delete from creator_journey_posts where \"postId\" in (select id from posts where title like 'Smoke delayed $STAMP%');
       delete from posts where title like 'Smoke delayed $STAMP%';
       update creator_profiles set \"showOnWebsite\"=$C_SHOWN, \"isFeatured\"=$C_FEAT where id='$C_ID';
       update creator_journeys set \"onWebsite\"=true where \"creatorId\"='$C_ID';
       update users set \"hideExactLocation\"=$C_HIDE where id='$C_USER';
       delete from audit_events where \"entityType\" in ('CreatorProfile','CreatorJourney') and \"createdAt\" >= '$START';" >/dev/null
}
trap cleanup EXIT

echo "== sign in"
EDITOR=$(staff_login tester.editor@bato.test); ADMIN=$(staff_login tester.admin@bato.test)
MOD=$(staff_login tester.moderator@bato.test); OWNER=$(login owner.fleet@bato.test)
ok "editor and moderator signed in" yes "$([ ${#EDITOR} -gt 40 ] && [ ${#MOD} -gt 40 ] && echo yes || echo no)"

echo "== who may manage events"
ok "signed out: no" 401 "$(call GET /events/admin "")"
ok "a moderator: no" 403 "$(call GET /events/admin "$MOD")"
ok "a bus owner: no" 403 "$(call GET /events/admin "$OWNER")"
ok "an editor: yes" 200 "$(call GET /events/admin "$EDITOR")"
ok "an admin: yes" 200 "$(call GET /events/admin "$ADMIN")"

echo "== adding an event"
S=$(npt 3 18); E=$(npt 3 21)
B="{\"title\":\"Smoke Festival $STAMP\",\"summary\":\"Music and food stalls by the lake, for the smoke test.\",\"category\":\"FESTIVAL\",\"city\":\"$CITY\",\"venue\":\"Lakeside\",\"startsAt\":\"$S\",\"endsAt\":\"$E\",\"priceLabel\":\"Free\",\"organiser\":\"Smoke Committee\",\"url\":\"https://example.com/smoke\",\"status\":\"DRAFT\"}"
ok "a bus owner cannot add one" 403 "$(call POST /events "$OWNER" "$B")"
ok "an editor adds a draft" 201 "$(call POST /events "$EDITOR" "$B")"
EV=$(get "data['id']"); SLUG=$(get "data['slug']")
ok "its address is made from the name and year" true "$(get "data['slug'].startswith('smoke-festival-$STAMP')")"
ok "a draft is not on the website" 404 "$(page "/events/$SLUG")"
page "/events" >/dev/null; ok "nor in the list" 0 "$(has "/events/$SLUG\"")"
BAD="{\"title\":\"Smoke Backwards $STAMP\",\"summary\":\"Ends before it starts, which cannot be.\",\"category\":\"MUSIC\",\"city\":\"$CITY\",\"startsAt\":\"$E\",\"endsAt\":\"$S\"}"
ok "ending before it starts is refused" 400 "$(call POST /events "$EDITOR" "$BAD")"
BAD="{\"title\":\"Smoke Link $STAMP\",\"summary\":\"A link that is not a web address at all.\",\"category\":\"MUSIC\",\"city\":\"$CITY\",\"startsAt\":\"$S\",\"url\":\"javascript:alert(1)\"}"
ok "a link that is not http(s) is refused" 400 "$(call POST /events "$EDITOR" "$BAD")"
BAD="{\"title\":\"Smoke Picture $STAMP\",\"summary\":\"A picture from somewhere else on the web.\",\"category\":\"MUSIC\",\"city\":\"$CITY\",\"startsAt\":\"$S\",\"imageUrl\":\"https://evil.example/x.jpg\"}"
ok "a picture not uploaded through Batoma is refused" 400 "$(call POST /events "$EDITOR" "$BAD")"
BAD="{\"title\":\"Smoke Short $STAMP\",\"summary\":\"Too short\",\"category\":\"MUSIC\",\"city\":\"$CITY\",\"startsAt\":\"$S\"}"
ok "a summary under 10 characters is refused" 400 "$(call POST /events "$EDITOR" "$BAD")"

echo "== published, it is on the website"
call GET "/events/admin/$EV" "$EDITOR" >/dev/null
FULL=$(get "__import__('json').dumps({**{k: data[k] for k in ['title','summary','category','city','venue','startsAt','endsAt','priceLabel','organiser','url']}, 'status':'PUBLISHED'})")
ok "an editor publishes it" 200 "$(call PATCH "/events/$EV" "$EDITOR" "$FULL")"
sleep 1
ok "its page is up" 200 "$(page "/events/$SLUG")"
ok "with its name, place and price" "1 1 1" "$(echo "$(has "Smoke Festival $STAMP") $(has "Lakeside, $CITY") $(has "Free")" | sed 's/[2-9]/1/g')"
ok "the date in BS beside AD" 1 "$(grep -cE '[0-9]{1,2} [A-Z][a-z]+ 20[89][0-9]' "$R" | sed 's/[2-9]/1/' )"
ok "Event data for search engines, scheduled, in Kathmandu time" "1 1 1" "$(echo "$(has '"@type":"Event"') $(has 'EventScheduled') $(has '+05:45')" | sed 's/[2-9]/1/g')"
ok "an Add to calendar link" 1 "$(has "/events/$SLUG/calendar.ics")"
page "/events" >/dev/null; ok "it is in the list" 1 "$(has "/events/$SLUG\"" | sed 's/[2-9]/1/')"
page "/events?city=$CITY" >/dev/null; ok "and under its town" 1 "$(has "/events/$SLUG\"" | sed 's/[2-9]/1/')"
page "/events?city=Nowhere$STAMP" >/dev/null; ok "an unknown town shows everything rather than nothing" 1 "$(has "/events/$SLUG\"" | sed 's/[2-9]/1/')"
ok "in the sitemap" 1 "$(page /sitemap.xml >/dev/null; has "/events/$SLUG<")"
CT=$(curl -s -o "$R" -w "%{content_type}" "$SITE/events/$SLUG/calendar.ics")
ok "the calendar file is a calendar" "text/calendar; charset=utf-8" "$CT"
ok "with the event in it, confirmed" "1 1 1" "$(echo "$(has "SUMMARY:Smoke Festival $STAMP") $(has "DTSTART:") $(has "STATUS:CONFIRMED")" | sed 's/[2-9]/1/g')"

echo "== all-day events, cancelling and removing"
D1=$(npt 5 10); D2=$(npt 6 10)
B="{\"title\":\"Smoke Fair $STAMP\",\"summary\":\"Two whole days of a craft market, for the smoke test.\",\"category\":\"MARKET\",\"city\":\"$CITY\",\"allDay\":true,\"startsAt\":\"$D1\",\"endsAt\":\"$D2\",\"status\":\"PUBLISHED\"}"
ok "an all-day event" 201 "$(call POST /events "$EDITOR" "$B")"
FAIR=$(get "data['slug']")
ok "starts at midnight in Kathmandu" "T18:15:00.000Z" "$(get "data['startsAt'][10:]")"
ok "its calendar file has whole days" 1 "$(curl -s -o "$R" "$SITE/events/$FAIR/calendar.ics"; has "DTSTART;VALUE=DATE:")"
FULL=$(echo "$FULL" | sed 's/"PUBLISHED"/"CANCELLED"/')
ok "an editor cancels the festival" 200 "$(call PATCH "/events/$EV" "$EDITOR" "$FULL")"
sleep 1
ok "still on the website" 200 "$(page "/events/$SLUG")"
ok "marked cancelled, for people and search engines" "1 1" "$(echo "$(has "has been cancelled") $(has "EventCancelled")" | sed 's/[2-9]/1/g')"
ok "no calendar link once cancelled" 0 "$(has "calendar.ics")"
ok "every change is in the audit log" 3 "$(sql "select count(*) from audit_events where \"entityType\"='Event' and \"entityId\"='$EV'")"
ok "a moderator cannot delete it" 403 "$(call DELETE "/events/$EV" "$MOD")"
ok "an editor deletes it" 200 "$(call DELETE "/events/$EV" "$EDITOR")"
sleep 1
ok "and it is gone from the website" 404 "$(page "/events/$SLUG")"

echo "== a story from Write a trip"
WRITER="smoke-writer-$STAMP@example.com"
STORY=$(python3 -c "print(('We took the early bus from Kathmandu and reached the hills by noon. ' * 8).strip())")
B=$(python3 -c "import json,sys; print(json.dumps({'name':'Smoke Writer','email':sys.argv[1],'title':'Smoke story $STAMP','place':'Bandipur','story':sys.argv[2],'ownWork':True}))" "$WRITER" "$STORY")
ok "without the site's key: refused" 403 "$(site POST /site/stories "$B")"
ok "sent by the website" 201 "$(site POST /site/stories "$B" "$KEY")"
LINK=$(get "data.get('devLink') or ''")
ok "the answer reveals nothing about the account" "Check your inbox" "$(get "data['message'][:16]")"
ok "a new account, not yet confirmed, with no password" "f f" "$(sql "select (\"emailVerifiedAt\" is not null)::text || ' ' || (\"passwordHash\" is not null)::text from users where email='$WRITER'" | sed 's/false/f/g; s/true/t/g')"
ok "the story waits for the email" AWAITING_EMAIL "$(sql "select status from story_submissions where title='Smoke story $STAMP'")"
ok "only a hash of the link is kept" 64 "$(sql "select length(\"confirmTokenHash\") from story_submissions where title='Smoke story $STAMP'")"
SHORT=$(python3 -c "import json,sys; print(json.dumps({'name':'Smoke Writer','email':sys.argv[1],'title':'Smoke story $STAMP short','story':'Too short to read.','ownWork':True}))" "$WRITER")
ok "a story under 300 characters is refused" 400 "$(site POST /site/stories "$SHORT" "$KEY")"
NOTMINE=$(echo "$B" | sed 's/"ownWork": true/"ownWork": false/')
ok "without saying it is their own writing: refused" 400 "$(site POST /site/stories "$NOTMINE" "$KEY")"
ID=$(sql "select id from story_submissions where title='Smoke story $STAMP'")
ok "editors cannot see it before it is confirmed" 404 "$(call GET "/stories/admin/$ID" "$EDITOR")"
if [ -n "$LINK" ]; then
  TOKEN=${LINK##*token=}
else # a mail server is set up: put a known link in place of the emailed one
  TOKEN="smoketoken$STAMP$STAMP"; sql "update story_submissions set \"confirmTokenHash\"=encode(sha256('$TOKEN'::bytea), 'hex') where id='$ID'" >/dev/null
fi
ok "a wrong link confirms nothing" 400 "$(site POST /site/stories/confirm "{\"token\":\"wrongtoken$STAMP$STAMP\"}" "$KEY")"
ok "the emailed link sends it on" 201 "$(site POST /site/stories/confirm "{\"token\":\"$TOKEN\"}" "$KEY")"
ok "the writer is asked to choose a password" true "$(get "str(data['needsPassword']).lower()")"
ok "the account is confirmed" t "$(sql "select (\"emailVerifiedAt\" is not null)::text from users where email='$WRITER'" | cut -c1)"
ok "and the password email is a set-up link" 1 "$(sql "select count(*) from email_tokens t join users u on u.id=t.\"userId\" where u.email='$WRITER' and t.type='RESET'")"
ok "the link works once" 400 "$(site POST /site/stories/confirm "{\"token\":\"$TOKEN\"}" "$KEY")"

echo "== the website's own form"
PAGE=$(curl -s "$SITE/write"); T=$(echo "$PAGE" | grep -o 'name="t" value="[^"]*"' | sed 's/.*value="//; s/"$//')
ok "the page has the form" 1 "$(echo "$PAGE" | grep -c 'action="/write#h-send"')"
sleep 3.2
CODE=$(curl -s -o "$R" -w "%{http_code}" -X POST "$SITE/write" --data-urlencode "name=Smoke Writer" --data-urlencode "email=smoke-writer-$STAMP-b@example.com" \
  --data-urlencode "title=Smoke story $STAMP by form" --data-urlencode "place=Pokhara" --data-urlencode "story=$STORY" --data-urlencode "ownWork=yes" --data-urlencode "website=" --data-urlencode "t=$T")
ok "sending it works (a link to confirm on this computer, or a redirect)" true "$([ "$CODE" = 200 ] || [ "$CODE" = 303 ] && echo true || echo "$CODE")"
ok "and it is waiting for its email" AWAITING_EMAIL "$(sql "select status from story_submissions where title='Smoke story $STAMP by form'")"

echo "== editors read, feature and decline"
ok "a moderator cannot read submissions" 403 "$(call GET /stories/admin "$MOD")"
ok "a bus owner cannot" 403 "$(call GET /stories/admin "$OWNER")"
ok "an editor sees it waiting" true "$(call GET /stories/admin "$EDITOR" >/dev/null; get "any(x['id']=='$ID' for x in data['items'])")"
ok "with the writer and a word count" "Smoke Writer|$WRITER|104" "$(get "[f\"{x['user']['name']}|{x['user']['email']}|{x['words']}\" for x in data['items'] if x['id']=='$ID'][0]")"
ok "and reads it in full" 200 "$(call GET "/stories/admin/$ID" "$EDITOR")"
SECTION=$(sql "select id from categories order by name limit 1")
ok "an editor features it" 201 "$(call POST "/stories/admin/$ID/feature" "$EDITOR" "{\"categoryId\":\"$SECTION\"}")"
ART=$(get "data['articleId']")
ok "it is a draft with the writer's byline" "DRAFT|Smoke Writer|Smoke story $STAMP|Bandipur" "$(sql "select a.status || '|' || u.name || '|' || a.title || '|' || coalesce(a.subtitle,'') from articles a join users u on u.id=a.\"authorId\" where a.id='$ART'")"
ok "with a summary from its first sentence" true "$(sql "select (summary like 'We took the early bus%')::text from articles where id='$ART'")"
ok "the story is marked featured" FEATURED "$(sql "select status from story_submissions where id='$ID'")"
ok "it cannot be featured twice" 400 "$(call POST "/stories/admin/$ID/feature" "$EDITOR" "{}")"
# The form's story, confirmed the same way, then declined with a note.
ID2=$(sql "select id from story_submissions where title='Smoke story $STAMP by form'")
sql "update story_submissions set status='SUBMITTED', \"submittedAt\"=now(), \"confirmTokenHash\"=null where id='$ID2'" >/dev/null
ok "an editor declines the other, with a note" 201 "$(call POST "/stories/admin/$ID2/decline" "$EDITOR" '{"note":"We covered Pokhara last month."}')"
ok "declined, with the note kept" "DECLINED|We covered Pokhara last month." "$(sql "select status || '|' || \"editorNote\" from story_submissions where id='$ID2'")"
ok "the tabs count them" true "$(call GET "/stories/admin?status=FEATURED" "$EDITOR" >/dev/null; get "data['counts']['FEATURED']>=1 and data['counts']['DECLINED']>=1")"
ok "every step is in the audit log" 3 "$(sql "select count(*) from audit_events where \"entityType\"='StorySubmission' and \"entityId\" in ('$ID','$ID2')")"

echo "== creators on the website"
HANDLE=anish_shrestha_treks
C_ID=$(sql "select id from creator_profiles where handle='$HANDLE'"); C_USER=$(sql "select \"userId\" from creator_profiles where id='$C_ID'")
C_SHOWN=$(sql "select \"showOnWebsite\"::text from creator_profiles where id='$C_ID'"); C_FEAT=$(sql "select \"isFeatured\"::text from creator_profiles where id='$C_ID'")
C_HIDE=$(sql "select \"hideExactLocation\"::text from users where id='$C_USER'")
JID=$(sql "select id from creator_journeys where \"creatorId\"='$C_ID' and status='PUBLISHED' limit 1"); JSLUG=$(sql "select slug from creator_journeys where id='$JID'")
ok "signed out cannot switch a creator on" 401 "$(call PATCH "/creators/admin/$C_ID/website" "" '{"showOnWebsite":true}')"
ok "a moderator cannot" 403 "$(call PATCH "/creators/admin/$C_ID/website" "$MOD" '{"showOnWebsite":true}')"
ok "a bus owner cannot" 403 "$(call PATCH "/creators/admin/$C_ID/website" "$OWNER" '{"showOnWebsite":true}')"
ok "an editor takes them off" 200 "$(call PATCH "/creators/admin/$C_ID/website" "$EDITOR" '{"showOnWebsite":false}')"
sleep 1
ok "then their page is not on the website" 404 "$(page "/creators/$HANDLE")"
page /creators >/dev/null; ok "nor in the list" 0 "$(has "/creators/$HANDLE\"")"
ok "an editor puts them on" 200 "$(call PATCH "/creators/admin/$C_ID/website" "$EDITOR" '{"showOnWebsite":true}')"
sleep 1
ok "their page is up" 200 "$(page "/creators/$HANDLE")"
ok "with their stories, journeys and stats" "1 1 1" "$(echo "$(has 'Stories in Batoma') $(has "/creators/$HANDLE/$JSLUG") $(has 'followers in the app')" | sed 's/[2-9]/1/g')"
ok "ProfilePage and Person data for search engines" "1 1" "$(echo "$(has '"@type":"ProfilePage"') $(has '"@type":"Person"')" | sed 's/[2-9]/1/g')"
ok "no coordinates anywhere on it" 0 "$(grep -cE 'latitude|longitude' "$R")"
ok "the journey page shows its costs" 1 "$(page "/creators/$HANDLE/$JSLUG" >/dev/null; has 'What it cost' | sed 's/[2-9]/1/')"
ok "an editor lists their journeys" 200 "$(call GET "/creators/admin/$C_ID/journeys" "$EDITOR")"
ok "and hides one from the website" 200 "$(call PATCH "/creators/admin/journeys/$JID/website" "$EDITOR" '{"onWebsite":false}')"
sleep 1
ok "the hidden journey is gone from the website" 404 "$(page "/creators/$HANDLE/$JSLUG")"
ok "but still in the app" 200 "$(call GET "/creators/$HANDLE/journeys/$JSLUG" "")"
call PATCH "/creators/admin/journeys/$JID/website" "$EDITOR" '{"onWebsite":true}' >/dev/null
PENDING_ID=$(sql "with u as (insert into users (id, email, name, language, \"updatedAt\") values (gen_random_uuid(), 'smoke-writer-$STAMP-creator@example.com', 'Smoke Creator', 'EN', now()) returning id)
  insert into creator_profiles (id, \"userId\", handle, \"displayName\", \"updatedAt\") select gen_random_uuid(), id, 'smk_$STAMP', 'Smoke Creator', now() from u returning id" | head -1)
ok "a creator still waiting for approval cannot go on the website" 400 "$(call PATCH "/creators/admin/$PENDING_ID/website" "$EDITOR" '{"showOnWebsite":true}')"
ok "an unknown creator" 404 "$(call PATCH "/creators/admin/00000000-0000-4000-8000-000000000000/website" "$EDITOR" '{"showOnWebsite":true}')"
ok "every switch is in the audit log" true "$(sql "select (count(*) >= 4)::text from audit_events where \"entityType\" in ('CreatorProfile','CreatorJourney') and \"createdAt\" >= '$START'")"

echo "== creators' privacy, in the app and on the website"
DELAYED=$(sql "insert into posts (id, \"authorId\", title, body, status, moderation, \"publishedAt\", \"visibleFrom\", latitude, longitude, \"locationName\", \"updatedAt\")
  values (gen_random_uuid(), '$C_USER', 'Smoke delayed $STAMP', 'Posted while travelling alone; it shows tomorrow.', 'PUBLISHED', 'APPROVED', now(), now() + interval '1 day', 27.7, 85.3, 'Somewhere', now()) returning id" | head -1)
sql "insert into creator_journey_posts (\"journeyId\", \"postId\", \"sortOrder\") values ('$JID', '$DELAYED', 99)" >/dev/null
call GET "/creators/$HANDLE" "" >/dev/null
ok "the app's profile leaves out a post still inside its safety delay" false "$(get "any(p['id']=='$DELAYED' for p in data['posts'])")"
call GET "/creators/$HANDLE/journeys/$JSLUG" "" >/dev/null
ok "and so does the journey that includes it" false "$(get "any(e['post']['id']=='$DELAYED' for e in data['entries'])")"
sleep 1
ok "the website never shows it either" 0 "$(page "/creators/$HANDLE" >/dev/null; has "Smoke delayed $STAMP")"
sql "update users set \"hideExactLocation\"=true where id='$C_USER'" >/dev/null
call GET "/creators/$HANDLE" "" >/dev/null
ok "a creator who hides their exact location: no coordinates in the app" "True 0" "$(get "f\"{all(p['latitude'] is None for p in data['posts'])} {len(data['pins'])}\"")"
call GET "/creators/$HANDLE/journeys/$JSLUG" "" >/dev/null
ok "nor in their journeys" true "$(get "all(e['post']['latitude'] is None for e in data['entries'])")"

finish
