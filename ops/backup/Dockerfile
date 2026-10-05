# Weekly encrypted logical backup of the Batoma database (Render cron job, see render.yaml).
# pg_dump from the same major version as the database, age for encryption to the team's
# public key, and the AWS CLI for any S3-compatible bucket (Cloudflare R2 included).
FROM postgres:16-alpine
RUN apk add --no-cache age aws-cli bash coreutils
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
