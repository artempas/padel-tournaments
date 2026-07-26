#!/bin/sh
set -e

# `migrate` runs the schema and exits — handy for a one-shot check.
if [ "$1" = "migrate" ]; then
  exec node scripts/migrate.mjs
fi

# The schema is idempotent, so applying it on every start is safe and saves
# having to shell into the NAS after an update. Set SKIP_MIGRATE=1 to opt out.
if [ "$SKIP_MIGRATE" != "1" ]; then
  # After a NAS reboot Postgres may still be coming up, so retry rather than
  # dropping into a restart loop.
  attempt=1
  until node scripts/migrate.mjs; do
    if [ "$attempt" -ge 10 ]; then
      echo "Database still unreachable after $attempt attempts — giving up."
      exit 1
    fi
    echo "Database not ready (attempt $attempt), retrying in 5s..."
    attempt=$((attempt + 1))
    sleep 5
  done
fi

echo "Starting Padel Tournaments on port ${PORT:-3000} (RP_ID=${RP_ID}, ORIGIN=${ORIGIN})"
exec node server.js
