#!/bin/sh
set -e

MIGRATE="./node_modules/prisma/build/index.js migrate deploy"

# `migrate` runs pending migrations and exits — handy for a one-shot check.
if [ "$1" = "migrate" ]; then
  exec node $MIGRATE
fi

# `migrate deploy` применяет только неприменённые миграции и ничего не трогает,
# если база уже актуальна, — поэтому запускать его на каждом старте безопасно
# и не надо ходить на NAS руками. Set SKIP_MIGRATE=1 to opt out.
if [ "$SKIP_MIGRATE" != "1" ]; then
  # After a NAS reboot Postgres may still be coming up, so retry rather than
  # dropping into a restart loop. Сообщение намеренно не утверждает, что дело в
  # базе: падать здесь может и сам CLI, а «database not ready» в таком случае
  # уводит в сторону — настоящая причина всегда выше в логе.
  attempt=1
  until node $MIGRATE; do
    if [ "$attempt" -ge 10 ]; then
      echo "Migration still failing after $attempt attempts — giving up (see the error above)."
      exit 1
    fi
    echo "Migration attempt $attempt failed, retrying in 5s..."
    attempt=$((attempt + 1))
    sleep 5
  done
fi

echo "Starting Padel Tournaments on port ${PORT:-3000} (RP_ID=${RP_ID}, ORIGIN=${ORIGIN})"
exec node server.js
