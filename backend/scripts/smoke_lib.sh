# Shared helpers for the API smoke scripts. Source it after setting DOC (the test
# accounts file) and, optionally, API, PSQL and PGDATABASE.
#
# Request bodies are built into variables before each call: macOS's bash 3.2 mangles
# escaped quotes written directly inside "$(...)".
API=${API:-http://localhost:3000/api/v1}
PSQL=${PSQL:-"$HOME/Applications/Postgres.app/Contents/Versions/16/bin/psql"}
SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="$SMOKE_DIR/_resp.json"
export PGPASSWORD=${PGPASSWORD:-travel}
# The database the API itself uses, so checks never read one copy's data and write another's.
PGDATABASE=${PGDATABASE:-$(sed -n 's#^DATABASE_URL=.*/\([^/?"]*\)?.*#\1#p' "$SMOKE_DIR/../.env" 2>/dev/null)}
PGDATABASE=${PGDATABASE:-travel_magazine}
sql(){ "$PSQL" -U travel -h localhost -d "$PGDATABASE" -tAc "$1"; }

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
secret_of(){ # email -> the account's authenticator secret, decrypted (it is encrypted at rest)
  node "$SMOKE_DIR/field-decrypt.mjs" "$(sql "select \"totpSecret\" from users where email='$1'")"
}
login(){ # email -> access token; answers the authenticator step if the account is asked for one
  local body="{\"email\":\"$1\",\"password\":\"$(pw "$1")\"}"
  call POST /auth/email/login "" "$body" >/dev/null
  if [ "$(get "bool(data.get('challengeToken'))")" = "true" ]; then
    local ch; ch=$(get "data['challengeToken']")
    local secret; secret=$(secret_of "$1")
    body="{\"challengeToken\":\"$ch\",\"code\":\"$(totp "$secret")\"}"
    call POST /auth/mfa/verify "" "$body" >/dev/null
  fi
  get "data['accessToken']"
}
staff_login(){ # email -> access token, through the authenticator step
  local body="{\"email\":\"$1\",\"password\":\"$(pw "$1")\"}"
  call POST /auth/email/login "" "$body" >/dev/null
  local ch; ch=$(get "data['challengeToken']")
  local secret; secret=$(secret_of "$1")
  body="{\"challengeToken\":\"$ch\",\"code\":\"$(totp "$secret")\"}"
  call POST /auth/mfa/verify "" "$body" >/dev/null; get "data['accessToken']"
}
iso(){ # seconds from now -> ISO 8601 in UTC
  python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%S.000Z'))" "$1"
}
finish(){
  rm -f "$R"
  echo
  echo "$pass passed, $fail failed"
  [ "$fail" -eq 0 ]
}
