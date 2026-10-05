#!/bin/bash
# Dumps the database (custom format), encrypts it to BACKUP_AGE_RECIPIENT (an age public
# key, "age1…"; the private key stays off the server, in the team's password manager),
# and uploads it to BACKUP_BUCKET. Keeps the newest BACKUP_KEEP (default 13) dumps.
#
# Encrypted personal fields stay encrypted inside the dump; the field keys are not in it.
# Restore drill: SECURITY.md, "Backups and restore".
set -euo pipefail
: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_BUCKET:?}" "${S3_ENDPOINT:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-auto}
KEEP=${BACKUP_KEEP:-13}
NAME="batoma-$(date -u +%Y-%m-%dT%H%MZ).pgcustom.age"
FILE="/tmp/$NAME"

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" -o "$FILE"
SIZE=$(stat -c %s "$FILE")
[ "$SIZE" -gt 1024 ] || { echo "Backup suspiciously small ($SIZE bytes); not uploaded." >&2; exit 1; }
aws --endpoint-url "$S3_ENDPOINT" s3 cp "$FILE" "s3://$BACKUP_BUCKET/weekly/$NAME" --only-show-errors
rm -f "$FILE"
echo "Uploaded $NAME ($SIZE bytes)."

# Prune: keep the newest $KEEP.
aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$BACKUP_BUCKET/weekly/" | awk '{print $4}' | grep '^batoma-' | sort | head -n -"$KEEP" | while read -r old; do
  aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://$BACKUP_BUCKET/weekly/$old" --only-show-errors && echo "Removed $old"
done
