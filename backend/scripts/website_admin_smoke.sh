#!/bin/bash
# The control panel's Website screen, against a running API and website: the overview,
# taking a published article off the website and putting it back (the app keeps it), and
# featuring it; the website's ads apart from the app's, and a website ad created, paused,
# resumed and removed, each change reaching the website at once through the page purge.
# Staff only: an editor and a bus company owner are refused. Changes are audited.
#
# Needs the website running (SITE in backend/.env, default http://localhost:4000).
# Everything it changes is put back, and the ad it creates is removed.
#
#   bash scripts/website_admin_smoke.sh ../../Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: website_admin_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

SITE=$(sed -n 's/^SITE_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$SMOKE_DIR/../.env"); SITE=${SITE:-http://localhost:4000}
STAMP=$(date +%s)
# The API writes UTC; this Mac's Postgres runs in Kathmandu time, so compare with a UTC mark.
START=$(date -u +"%Y-%m-%d %H:%M:%S")
page(){ curl -s -o "$R" -w "%{http_code}" "$SITE$1"; }
has(){ grep -c -F "$1" "$R" | tr -d ' '; }
# The purge is fire and forget; give it a moment to land before reading the website.
settle(){ sleep 1; }

ADMIN=$(staff_login tester.admin@bato.test)
EDITOR=$(staff_login tester.editor@bato.test)
OWNER=$(login owner.fleet@bato.test)

echo "Overview"
ok "overview answers" 200 "$(call GET /admin/site/overview "$ADMIN")"
ok "overview names the website" "$SITE" "$(get "data['siteUrl']")"
ok "overview counts stories on the website" true "$(get "isinstance(data['articles']['onSite'], int)")"
ok "an editor cannot open it" 403 "$(call GET /admin/site/overview "$EDITOR")"
ok "a bus company owner cannot open it" 403 "$(call GET /admin/site/overview "$OWNER")"

echo "Articles"
ok "published articles on the website" 200 "$(call GET '/admin/site/articles?show=on' "$ADMIN")"
ART=$(get "data['items'][0]['id']"); SLUG=$(get "data['items'][0]['slug']"); TITLE=$(get "data['items'][0]['title']")
FEATURED=$(get "data['items'][0]['isFeatured']")
ok "every row is on the website" true "$(get "all(a['onWebsite'] for a in data['items'])")"
ok "a row links to its page on the website" "$SITE/magazine/$SLUG" "$(get "data['items'][0]['url']")"
ok "it is on the website" 200 "$(page "/magazine/$SLUG")"

B='{"onWebsite":false}'
ok "an editor cannot take it off" 403 "$(call PATCH "/admin/site/articles/$ART" "$EDITOR" "$B")"
ok "taken off the website" 200 "$(call PATCH "/admin/site/articles/$ART" "$ADMIN" "$B")"
ok "the answer says so" false "$(get "data['onWebsite']")"
settle
ok "its page is gone from the website" 404 "$(page "/magazine/$SLUG")"
page /sitemap.xml >/dev/null
ok "and from the sitemap" 0 "$(has "/magazine/$SLUG<")"
page /magazine >/dev/null
ok "and from the magazine list" 0 "$(has "/magazine/$SLUG\"")"
ok "the app still has it" 200 "$(call GET "/magazine/articles/$SLUG" "")"
call GET '/admin/site/articles?show=off' "$ADMIN" >/dev/null
ok "listed under taken off" true "$(get "any(a['id'] == '$ART' for a in data['items'])")"
ok "the change is audited" 1 "$(sql "select count(*) from audit_events where action='article.website' and \"entityId\"='$ART' and summary like '%taken off the website' and \"createdAt\" >= '$START'")"

B='{"onWebsite":true}'
ok "put back on the website" 200 "$(call PATCH "/admin/site/articles/$ART" "$ADMIN" "$B")"
settle
ok "its page is back" 200 "$(page "/magazine/$SLUG")"

FLIP=$([ "$FEATURED" = "true" ] && echo false || echo true)
B="{\"isFeatured\":$FLIP}"
ok "featuring can be changed" 200 "$(call PATCH "/admin/site/articles/$ART" "$ADMIN" "$B")"
ok "and is" "$FLIP" "$(get "data['isFeatured']")"
B="{\"isFeatured\":$FEATURED}"
ok "and put back" 200 "$(call PATCH "/admin/site/articles/$ART" "$ADMIN" "$B")"
B='{}'
ok "an empty change is refused" 400 "$(call PATCH "/admin/site/articles/$ART" "$ADMIN" "$B")"
ok "an unknown article is a 404" 404 "$(call PATCH "/admin/site/articles/00000000-0000-4000-8000-000000000000" "$ADMIN" '{"onWebsite":true}')"

echo "Ads"
ok "website ads" 200 "$(call GET '/ads/admin?surface=web' "$ADMIN")"
ok "only website placements" true "$(get "all(a['placement'].startswith('WEB_') for a in data)")"
ok "each with website counts" true "$(get "all('site' in a for a in data)")"
ok "app ads" 200 "$(call GET '/ads/admin?surface=app' "$ADMIN")"
ok "no website placements" true "$(get "not any(a['placement'].startswith('WEB_') for a in data)")"

# Ads only accept the API's own media URLs: reuse an ad's picture, or upload a small one.
IMG=$(sql "select \"imageUrl\" from advertisements limit 1")
UPLOADED=""
if [ -z "$IMG" ]; then
  PNG="$SMOKE_DIR/_smoke_ad.png"
  python3 - "$PNG" <<'PNGPY'
import sys, struct, zlib
w, h = 96, 48
rows = b''.join(b'\x00' + bytes([91, 63, 168]) * w for _ in range(h))
chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
open(sys.argv[1], 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
PNGPY
  curl -s -o "$R" -X POST "$API/media/upload" -H "Authorization: Bearer $ADMIN" -F "files=@$PNG;type=image/png" >/dev/null
  rm -f "$PNG"
  IMG=$(get "data['files'][0]['url']"); UPLOADED=$IMG
fi
if [ -z "$IMG" ] || [ "${IMG#<}" != "$IMG" ]; then
  echo "  skip  no ad picture could be uploaded: website ad lifecycle not checked"
else
  AD_TITLE="Smoke website ad $STAMP"
  B="{\"title\":\"$AD_TITLE\",\"advertiserName\":\"Smoke test\",\"imageUrl\":\"$IMG\",\"placement\":\"WEB_HOME_HERO\",\"durationUnit\":\"DAY\",\"durationCount\":1,\"startsAt\":\"$(iso -60)\",\"linkType\":\"EXTERNAL\",\"externalUrl\":\"https://example.com\",\"routeIds\":[]}"
  ok "a website ad is created" 201 "$(call POST /ads/admin "$ADMIN" "$B")"
  AD=$(get "data['id']")
  settle
  page / >/dev/null
  # Several ads may share the spot (newest first); this one was created last, so it shows.
  ok "it shows on the home page" 1 "$(has "$AD_TITLE")"
  B='{"isActive":false}'
  ok "paused" 200 "$(call PATCH "/ads/admin/$AD/active" "$ADMIN" "$B")"
  settle; page / >/dev/null
  ok "it is gone from the home page" 0 "$(has "$AD_TITLE")"
  B='{"isActive":true}'
  ok "resumed" 200 "$(call PATCH "/ads/admin/$AD/active" "$ADMIN" "$B")"
  settle; page / >/dev/null
  ok "it is back" 1 "$(has "$AD_TITLE")"
  ok "removed" 200 "$(call DELETE "/ads/admin/$AD" "$ADMIN")"
  settle; page / >/dev/null
  ok "and gone for good" 0 "$(has "$AD_TITLE")"
fi
# The picture this run uploaded, in every size, if the API keeps pictures on this disk.
if [ -n "$UPLOADED" ]; then NAME=${UPLOADED##*/}; rm -f "$SMOKE_DIR/../uploads/${NAME:0:36}"-*.webp; fi

echo
echo "website admin smoke: $pass passed, $fail failed"
rm -f "$R"
[ "$fail" -eq 0 ]
