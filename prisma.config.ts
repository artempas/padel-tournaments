import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 больше не читает .env самостоятельно и не принимает url в
// datasource-блоке схемы. Проект хранит настройки в .env.local; в проде
// переменные уже лежат в окружении, поэтому отсутствие файла — не ошибка.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env.local'));
} catch {
  // .env.local нет — значит DATABASE_URL пришёл из окружения.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=.env.local scripts/seed-demo.mjs',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
