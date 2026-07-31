# syntax=docker/dockerfile:1

# ---- dependencies -----------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
# postinstall = `prisma generate`, поэтому схема нужна уже на этом шаге.
COPY prisma ./prisma
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
RUN npm run build

# ---- prisma CLI -------------------------------------------------------------
# Мигратору нужен CLI целиком. Вырезать node_modules/prisma и node_modules/@prisma
# из общего дерева нельзя: @prisma/config требует effect, c12, jiti и ещё сотню
# пакетов, которые npm поднял в корень node_modules, — без них CLI падает с
# `Cannot find module 'effect'`. Поэтому ставим CLI в отдельную папку, где npm
# сам разложит всё замыкание зависимостей. Версия берётся из lock-файла, чтобы
# CLI не разъезжался с @prisma/client.
FROM node:22-alpine AS migrator
WORKDIR /migrator
COPY package-lock.json ./app-lock.json
RUN npm init -y > /dev/null \
 && npm install --no-audit --no-fund \
      "prisma@$(node -p "require('./app-lock.json').packages['node_modules/prisma'].version")" \
 && rm app-lock.json

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# The standalone bundle carries its own minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The standalone bundle does not carry public/ either — and without it there is
# no service worker and no manifest icons.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations run from the same image, so they ship with it. `prisma migrate
# deploy` нужен CLI, схема, миграции и конфиг — standalone-бандл их не тащит.
# CLI приезжает целиком отдельной стадией и ложится поверх node_modules из
# standalone: пересечений там нет, кроме @prisma/*, а они той же версии.
COPY --from=migrator --chown=nextjs:nodejs /migrator/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
