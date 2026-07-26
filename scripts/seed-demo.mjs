/**
 * Seeds a demo organiser, a session token and a partly-played tournament.
 * Handy for looking at the UI without going through a passkey ceremony.
 *
 *   npm run seed:demo
 */
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const username = 'demo';
await client.query('DELETE FROM users WHERE username = $1', [username]);
const { rows } = await client.query(
  'INSERT INTO users (username, display_name) VALUES ($1, $1) RETURNING id',
  [username],
);
const userId = rows[0].id;

const token = randomBytes(32).toString('base64url');
await client.query(
  "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
  [createHash('sha256').update(token).digest('hex'), userId],
);
const cookie = `padel_session=${token}`;

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const created = await api('/api/tournaments', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Пятничный американо',
    players: ['Артём', 'Борис', 'Вера', 'Галина', 'Дмитрий', 'Елена', 'Женя', 'Зоя'],
    courts: 2,
    pointsPerMatch: 16,
  }),
});
if (created.status !== 201) throw new Error(JSON.stringify(created.body));
const id = created.body.id;

// Play the first three rounds so the UI shows results, a live round and a table.
const detail = (await api(`/api/tournaments/${id}`)).body.tournament;
const scores = [
  [11, 5],
  [9, 7],
  [8, 8],
  [12, 4],
  [10, 6],
  [6, 10],
];
for (const [i, match] of detail.matches.slice(0, 6).entries()) {
  await api(`/api/tournaments/${id}/matches/${match.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ score1: scores[i][0], score2: scores[i][1] }),
  });
}

await client.end();

console.log('token:', token);
console.log('tournament:', `${BASE}/tournaments/${id}`);
