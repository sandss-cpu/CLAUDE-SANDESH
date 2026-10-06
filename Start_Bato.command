#!/bin/bash
# Double-click this file to run Batoma on this Mac.
#
# It is written for a fresh copy: if the dependencies, the .env or the database
# tables are missing it sets them up, then starts the API and the web server and
# opens the preview page. Running it twice is safe — anything already running is
# left alone.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

up(){ curl -s -o /dev/null --max-time 2 "$1"; }
step(){ printf '\n▸ %s\n' "$1"; }
stop(){ printf '\n✖ %s\n\n' "$1"; read -r -p "Press return to close."; exit 1; }

command -v node >/dev/null 2>&1 || stop "Node.js is not installed. Install Node 20 or newer from nodejs.org, then run this again."

# ---------------------------------------------------------------- database
PGBIN=""
for candidate in "$HOME/Applications/Postgres.app/Contents/Versions"/*/bin \
                 "/Applications/Postgres.app/Contents/Versions"/*/bin; do
  [ -x "$candidate/pg_isready" ] && PGBIN="$candidate" && break
done

if [ -n "$PGBIN" ] && ! "$PGBIN/pg_isready" -h localhost -p 5432 >/dev/null 2>&1; then
  step "Starting the database…"
  "$PGBIN/pg_ctl" -D "$HOME/pgdata-bato" -l "$HOME/pgdata-bato/server.log" -o "-p 5432" start >/dev/null 2>&1
  sleep 2
fi

if [ -n "$PGBIN" ] && ! "$PGBIN/pg_isready" -h localhost -p 5432 >/dev/null 2>&1; then
  stop "PostgreSQL is not answering on port 5432. Start Postgres, then run this again.
   Setting one up for the first time is in Docs/Hosting_Guide.md."
fi

# ---------------------------------------------------------------- configuration
if [ ! -f "$BACKEND/.env" ]; then
  step "Writing backend/.env for local use…"
  # A real signing secret rather than the example placeholder, which the API
  # refuses to start with — deliberately, so a placeholder never reaches a server.
  SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)"
  cat > "$BACKEND/.env" <<ENV
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://travel:travel@localhost:5432/batoma_phase3?schema=public"
JWT_SECRET=$SECRET
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_DAYS=60
CORS_ORIGINS=http://localhost:5173
PUBLIC_WEB_URL=http://localhost:5173
API_PUBLIC_URL=http://localhost:3000
MEDIA_BASE_URL=http://localhost:3000/static
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=8
ENV
  echo "  created (login codes are printed by the API in development)"
fi

# Phone and licence numbers, emergency contacts and authenticator secrets are stored
# encrypted. Without the keys they show scrambled and authenticator sign-ins fail.
if ! grep -q '^FIELD_ENCRYPTION_KEYS=.' "$BACKEND/.env" || ! grep -q '^BLIND_INDEX_KEY=.' "$BACKEND/.env"; then
  printf '\n⚠ backend/.env has no FIELD_ENCRYPTION_KEYS or BLIND_INDEX_KEY.\n'
  echo "  Copy both lines from the password manager (or another copy's backend/.env),"
  echo "  or phone numbers show scrambled and authenticator sign-ins fail."
fi

# ---------------------------------------------------------------- dependencies
# Installed again whenever package-lock.json or the database schema changes (an update
# taken from GitHub, for example), not only on the first run: old packages or an old
# database client make the API fail at start.
STAMP="$BACKEND/node_modules/.batoma-install"
WANT="$(cd "$BACKEND" && cat package-lock.json prisma/schema.prisma | shasum -a 256 | cut -d' ' -f1)"
if [ "$(cat "$STAMP" 2>/dev/null)" != "$WANT" ]; then
  if up http://localhost:3000/health; then
    stop "The packages changed, but an API is running from some copy. Stop it, then run this again."
  fi
  if [ -d "$BACKEND/node_modules" ]; then
    step "Updating dependencies (the packages changed, this takes a few minutes)…"
  else
    step "Installing dependencies (first run only, this takes a few minutes)…"
  fi
  (cd "$BACKEND" && npm ci) || stop "npm ci failed. The output above says why."
  (cd "$BACKEND" && npx prisma generate) || stop "prisma generate failed."
  echo "$WANT" > "$STAMP"
fi

# ---------------------------------------------------------------- tables & demo data
step "Applying database migrations…"
(cd "$BACKEND" && npx prisma migrate deploy >/dev/null 2>&1) || \
  echo "  migrations could not be applied — check that the batoma_phase3 database exists"

if [ ! -f "$BACKEND/.bato_seeded" ]; then
  step "Loading the demo content (first run only)…"
  if (cd "$BACKEND" && npm run seed >/dev/null 2>&1); then
    touch "$BACKEND/.bato_seeded"
    echo "  demo routes, articles, businesses and emergency numbers loaded"
  else
    echo "  seeding skipped — the app still runs on its bundled demo content"
  fi
fi

# ---------------------------------------------------------------- servers
if ! up http://localhost:3000/health; then
  step "Starting the API…"
  (cd "$BACKEND" && nohup npm run start:dev > /tmp/bato_backend.log 2>&1 &)
  for _ in $(seq 1 90); do up http://localhost:3000/health && break; sleep 1; done
  up http://localhost:3000/health || stop "The API did not start. The log is at /tmp/bato_backend.log"
fi

# 5173 specifically: it is the only origin the API allows by default, so the
# pages cannot call the API from any other port.
if ! up http://localhost:5173/preview.html; then
  step "Starting the web server…"
  # Node rather than python -m http.server: sticker links (/b/<code>) need a rewrite to
  # the reader, and macOS refuses the system Python access to a copy kept on the Desktop.
  (cd "$ROOT" && nohup node scripts/dev-web-server.mjs > /tmp/bato_web_server.log 2>&1 &)
  sleep 1
fi

open "http://localhost:5173/preview.html"

cat <<INFO

✅ Batoma is running.

   Preview & testing   http://localhost:5173/preview.html   ← opened for you
   Traveller app       http://localhost:5173/index.html
   Bus owner portal    http://localhost:5173/owner.html
   Control panel       http://localhost:5173/admin.html
   API health          http://localhost:3000/health

   Test logins are in Bato_Docs/Bato_Test_Accounts_Phase3.md, which is kept out of
   this folder and out of GitHub on purpose.

   Logs: /tmp/bato_backend.log and /tmp/bato_web_server.log
   You can close this window; the servers keep running.

INFO
read -r -p "Press return to close."
