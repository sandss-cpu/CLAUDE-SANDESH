#!/bin/bash
# Checks a live Batoma after a deploy. Read-only: it signs in, reads and scans, but changes
# nothing except one scan's counter.
#
#   bash scripts/prod_smoke.sh https://<PUBLIC_DOMAIN> [https://app.<PUBLIC_DOMAIN>] [https://<api address>]
#
# Optional, from the environment (never typed into a file or a chat):
#   SMOKE_QR            a test bus's code (a bus of the TEST company, see GO_LIVE.md)
#   SMOKE_OWNER_EMAIL   the TEST company's owner account
#   SMOKE_OWNER_PASSWORD
#   SMOKE_OWNER_TOTP    its authenticator secret, if the account has one
# Without them, the scan and owner checks are skipped and said to be skipped.
set -uo pipefail
SITE=${1:?"usage: prod_smoke.sh https://<PUBLIC_DOMAIN> [https://app.<PUBLIC_DOMAIN>] [https://<api address>]"}
SITE=${SITE%/}
APP=${2:-$(echo "$SITE" | sed 's#://#://app.#')}
APP=${APP%/}
API_ORIGIN=${3:-}
API="$APP/api/v1"
R=$(mktemp)
pass=0; fail=0; skipped=0
ok(){ if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok    $1"; else fail=$((fail+1)); echo "  FAIL  $1: expected $2, got $3"; fi; }
skip(){ skipped=$((skipped+1)); echo "  skip  $1"; }
status(){ curl -s -o "$R" -w "%{http_code}" --max-time 20 "$@"; }
header(){ curl -s -D - -o /dev/null --max-time 20 "$1" | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }
json(){ python3 -c "import sys,json; d=json.load(open(sys.argv[1])); v=eval(sys.argv[2]); print(str(v).lower() if isinstance(v, bool) else v)" "$R" "$1" 2>/dev/null; }

echo "== health"
if [ -n "$API_ORIGIN" ]; then ok "API /health" 200 "$(status "${API_ORIGIN%/}/health")"; else skip "API /health (give the API's own address as the third argument)"; fi
ok "website /healthz" 200 "$(status "$SITE/healthz")"
ok "the app answers" 200 "$(status "$APP/")"
ok "the API through the app's domain" 200 "$(status "$API/magazine/categories")"

echo "== https and headers"
ok "the website redirects plain http" true "$(c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${SITE/https:/http:}/"); [[ "$c" =~ ^30[178]$ ]] && echo true || echo "$c")"
ok "app: strict scripts" true "$(header "$APP/" content-security-policy | grep -q "script-src 'self';" && echo true || echo false)"
ok "app: HSTS" true "$(header "$APP/" strict-transport-security | grep -q 'max-age=63072000' && echo true || echo false)"
ok "app: camera only on the scan page" "camera=(self)" "$(header "$APP/scan.html" permissions-policy | grep -o 'camera=([a-z]*)')"
ok "website: no script at all" true "$(header "$SITE/" content-security-policy | grep -q "script-src 'none'" && echo true || echo false)"
ok "API: no wildcard CORS" "" "$(curl -s -D - -o /dev/null --max-time 20 -H 'Origin: https://evil.example' "$API/magazine/categories" | tr -d '\r' | grep -i '^access-control-allow-origin' )"

echo "== the public website"
for p in / /magazine /trips /partners /deals /write /advertise /about /contact /privacy /terms /newsletter /robots.txt /sitemap.xml; do
  ok "website $p" 200 "$(status "$SITE$p")"
done
ok "no bus or QR links on the home page" 0 "$(curl -s --max-time 20 "$SITE/" | grep -cE 'href="[^"]*(/b/|bus\.html|scan\.html|owner\.html)')"

echo "== a sticker, scanned"
if [ -n "${SMOKE_QR:-}" ]; then
  LOC=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$SITE/b/$SMOKE_QR")
  ok "the short link hands the code to the app" "$APP/b/$SMOKE_QR" "$LOC"
  ok "the app opens on it" 200 "$(status "$APP/b/$SMOKE_QR")"
  ok "the scan resolves" 201 "$(status -X POST -H 'Content-Type: application/json' -d '{}' "$API/qr/r/$SMOKE_QR")"
  ok "with stories for this bus" true "$(json "len(d['data'].get('routeArticles') or []) > 0")"
  SLUG=$(json "(d['data'].get('routeArticles') or [{}])[0].get('slug','')")
  if [ -n "$SLUG" ]; then ok "a story opens" 200 "$(status "$API/magazine/articles/$SLUG")"; else skip "story (none in the scan answer)"; fi
else
  skip "scan (set SMOKE_QR to a TEST company bus's code)"
fi

echo "== an owner signs in"
if [ -n "${SMOKE_OWNER_EMAIL:-}" ] && [ -n "${SMOKE_OWNER_PASSWORD:-}" ]; then
  B=$(python3 -c "import json,os; print(json.dumps({'email': os.environ['SMOKE_OWNER_EMAIL'], 'password': os.environ['SMOKE_OWNER_PASSWORD']}))")
  ok "sign in" 201 "$(status -X POST -H 'Content-Type: application/json' -d "$B" "$API/auth/email/login")"
  if [ "$(json "d['data'].get('mfaRequired')")" = "true" ]; then
    if [ -n "${SMOKE_OWNER_TOTP:-}" ]; then
      CH=$(json "d['data']['challengeToken']")
      CODE=$(python3 - "$SMOKE_OWNER_TOTP" <<'PY'
import sys, base64, hmac, hashlib, struct, time
s = sys.argv[1]; k = base64.b32decode(s.upper() + '=' * ((8 - len(s) % 8) % 8))
h = hmac.new(k, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest(); o = h[-1] & 15
print(f"{(struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000:06d}")
PY
)
      B=$(python3 -c "import json,sys; print(json.dumps({'challengeToken': sys.argv[1], 'code': sys.argv[2]}))" "$CH" "$CODE")
      ok "authenticator code accepted" 201 "$(status -X POST -H 'Content-Type: application/json' -d "$B" "$API/auth/mfa/verify")"
    else
      skip "authenticator step (set SMOKE_OWNER_TOTP)"
    fi
  fi
  TOKEN=$(json "d['data'].get('accessToken','')")
  if [ -n "$TOKEN" ]; then
    ok "the owner's companies" 200 "$(status -H "Authorization: Bearer $TOKEN" "$API/fleet/companies")"
    ok "only the TEST company is used for smoke checks" true "$(json "all(c['name'].upper().startswith('TEST') for c in d['data'])")"
    ok "an owner cannot reach the control panel's routes" 403 "$(status -H "Authorization: Bearer $TOKEN" "$API/admin/overview")"
  fi
else
  skip "owner sign-in (set SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD)"
fi

echo "== signed out"
ok "fleet routes need a session" 401 "$(status "$API/fleet/companies")"
ok "admin routes need a session" 401 "$(status "$API/admin/overview")"

rm -f "$R"
echo
echo "$pass passed, $fail failed, $skipped skipped"
[ "$fail" -eq 0 ]
