import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// Next's dev server re-evaluates modules on every change; without a global the
// client would leak a new connection pool on each reload.
declare global {
  var __padelPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env.local');
  }
  // Prisma 7 ходит в базу через driver adapter; берём тот же `pg`, что и раньше.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 10 }) });
}

function client(): PrismaClient {
  if (!globalThis.__padelPrisma) globalThis.__padelPrisma = createClient();
  return globalThis.__padelPrisma;
}

/**
 * Клиент создаётся при первом обращении, а не при импорте: `next build`
 * загружает каждый route-модуль, чтобы собрать метаданные, и делать это без
 * доступной базы он должен уметь. Прокси нужен только ради этой отложенности —
 * снаружи `prisma` ведёт себя как обычный PrismaClient.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const active = client() as unknown as Record<string | symbol, unknown>;
    const value = active[prop];
    return typeof value === 'function' ? value.bind(active) : value;
  },
});
