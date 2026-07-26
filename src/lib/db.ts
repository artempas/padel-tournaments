import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// Next's dev server re-evaluates modules on every change; without a global the
// pool would leak a new set of connections on each reload.
declare global {
  var __padelPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env.local');
  }
  return new Pool({ connectionString, max: 10 });
}

/**
 * Created on first use, not at import time: `next build` loads every route
 * module to collect metadata, and it must not need a reachable database.
 */
export function getPool(): Pool {
  if (!globalThis.__padelPool) globalThis.__padelPool = createPool();
  return globalThis.__padelPool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as never[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
