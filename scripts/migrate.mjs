import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const schemaPath = fileURLToPath(new URL('../db/schema.sql', import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  process.exit(1);
}

const sql = await readFile(schemaPath, 'utf8');
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();

  // The schema relies on gen_random_uuid(), which is only built in from
  // PostgreSQL 13. Fail with a clear message instead of a cryptic SQL error.
  const { rows } = await client.query('SHOW server_version_num');
  const version = Number(rows[0].server_version_num);
  if (version < 130000) {
    const readable = (version / 10000).toFixed(0);
    console.error(
      `PostgreSQL ${readable} detected — version 13 or newer is required.\n` +
        'On an older server, run `CREATE EXTENSION pgcrypto;` in this database first.',
    );
    process.exit(1);
  }

  await client.query(sql);
  console.log('Schema applied to', url.replace(/:\/\/[^@]*@/, '://***@'));
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
