#!/bin/bash
# Builds a throwaway database for the end-to-end tests (npm run test:e2e): every
# migration, the demo seed, the test accounts and demo companies, a duty log, income,
# road guides, the website role, and encrypted personal fields. Run it again to start
# clean; it drops the database first.
#
#   bash scripts/test-db.sh                    # batoma_test on localhost:5432
#   TEST_DB=other bash scripts/test-db.sh
#
# Writes the test accounts' passwords to $E2E_ACCOUNTS (default: test/.accounts.md,
# git-ignored), which the tests read.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-batoma_test}
PGHOST=${PGHOST:-localhost}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-travel}; export PGPASSWORD=${PGPASSWORD:-travel}
PSQL=${PSQL:-$(command -v psql || echo "$HOME/Applications/Postgres.app/Contents/Versions/16/bin/psql")}
export E2E_ACCOUNTS=${E2E_ACCOUNTS:-$PWD/test/.accounts.md}
mkdir -p "$(dirname "$E2E_ACCOUNTS")"
export DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB?schema=public"

"$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB OWNER $PGUSER"
npx prisma migrate deploy >/dev/null
npm run --silent seed >/dev/null
TEST_ACCOUNTS_FILE="$E2E_ACCOUNTS" npm run --silent accounts:test >/dev/null
npm run --silent seed:guides >/dev/null
npm run --silent seed:trips >/dev/null
npm run --silent seed:income >/dev/null
# Seeds encrypt as they write; this catches anything a script wrote some other way.
npm run --silent fields:encrypt -- --check || npm run --silent fields:encrypt
chmod 600 "$E2E_ACCOUNTS"
echo "Test database $DB ready; accounts in $E2E_ACCOUNTS"
