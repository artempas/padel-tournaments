/**
 * End-to-end smoke test against a running dev server.
 *
 * WebAuthn ceremonies need a real authenticator, so this seeds a session row
 * directly and then drives the tournament API exactly as the UI does.
 *
 *   npm run dev          # in one terminal
 *   npm run smoke        # in another
 */
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${label}\n       ${err.message}`);
  }
}

await client.connect();

const username = `smoke-${Date.now()}`;
const { rows } = await client.query(
  'INSERT INTO users (username, display_name) VALUES ($1, $1) RETURNING id',
  [username],
);
const userId = rows[0].id;

const token = randomBytes(32).toString('base64url');
await client.query(
  "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
  [createHash('sha256').update(token).digest('hex'), userId],
);

const cookie = `padel_session=${token}`;

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

try {
  console.log('\nauth');
  const me = await api('/api/auth/me');
  check('session is recognised', () => assert.equal(me.body.user?.username, username));

  const anon = await fetch(`${BASE}/api/tournaments`);
  check('anonymous access is rejected', () => assert.equal(anon.status, 401));

  console.log('\ncreate');
  const players = ['Артём', 'Борис', 'Вера', 'Галина', 'Дмитрий', 'Елена', 'Женя', 'Зоя'];
  const created = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Americano', players, courts: 2, pointsPerMatch: 16 }),
  });
  check('tournament created', () => assert.equal(created.status, 201));
  const id = created.body.id;

  const tooFew = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', players: ['a', 'b'], courts: 1 }),
  });
  check('rejects fewer than four players', () => assert.equal(tooFew.status, 400));

  const dupes = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', players: ['a', 'A', 'b', 'c'], courts: 1 }),
  });
  check('rejects duplicate names', () => assert.equal(dupes.status, 400));

  console.log('\nschedule');
  let detail = (await api(`/api/tournaments/${id}`)).body.tournament;
  check('14 matches for 8 players', () => assert.equal(detail.matches.length, 14));
  check('7 rounds on 2 courts', () =>
    assert.equal(new Set(detail.matches.map((m) => m.round)).size, 7));
  check('status starts as running', () => assert.equal(detail.status, 'running'));

  check('nobody plays twice in a round', () => {
    const byRound = new Map();
    for (const m of detail.matches) {
      const set = byRound.get(m.round) ?? new Set();
      for (const p of [...m.team1, ...m.team2]) {
        assert.ok(!set.has(p), `player double-booked in round ${m.round}`);
        set.add(p);
      }
      byRound.set(m.round, set);
    }
  });

  check('every pair partners exactly once', () => {
    const counts = new Map();
    for (const m of detail.matches) {
      for (const team of [m.team1, m.team2]) {
        const key = [...team].sort().join('|');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    assert.equal(counts.size, 28, 'expected all 28 pairs');
    for (const [key, n] of counts) assert.equal(n, 1, `pair ${key} played ${n} times`);
  });

  console.log('\nscoring');
  const first = detail.matches[0];
  const bad = await api(`/api/tournaments/${id}/matches/${first.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ score1: 10, score2: 10 }),
  });
  check('rejects scores that do not sum to 16', () => assert.equal(bad.status, 400));

  const scored = await api(`/api/tournaments/${id}/matches/${first.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ score1: 11, score2: 5 }),
  });
  check('accepts a valid score', () => assert.equal(scored.status, 200));
  check('score is persisted', () => {
    const m = scored.body.tournament.matches.find((x) => x.id === first.id);
    assert.equal(m.score1, 11);
    assert.equal(m.score2, 5);
  });
  check('still running with matches left', () =>
    assert.equal(scored.body.tournament.status, 'running'));

  const cleared = await api(`/api/tournaments/${id}/matches/${first.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ score1: null, score2: null }),
  });
  check('score can be cleared', () => {
    const m = cleared.body.tournament.matches.find((x) => x.id === first.id);
    assert.equal(m.score1, null);
  });

  console.log('\ncompletion');
  let last;
  for (const [index, match] of detail.matches.entries()) {
    last = await api(`/api/tournaments/${id}/matches/${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ score1: index % 2 === 0 ? 9 : 7, score2: index % 2 === 0 ? 7 : 9 }),
    });
    assert.equal(last.status, 200, `scoring match ${index} failed`);
  }
  detail = last.body.tournament;
  check('tournament finishes when the last match is scored', () =>
    assert.equal(detail.status, 'finished'));
  check('finish timestamp is set', () => assert.ok(detail.finishedAt));

  check('total points equal matches × 16 × 2 players', () => {
    const total = detail.matches.reduce((sum, m) => sum + (m.score1 + m.score2) * 2, 0);
    assert.equal(total, 14 * 16 * 2);
  });

  console.log('\nisolation');
  const otherUser = await client.query(
    'INSERT INTO users (username, display_name) VALUES ($1, $1) RETURNING id',
    [`${username}-other`],
  );
  const otherToken = randomBytes(32).toString('base64url');
  await client.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [createHash('sha256').update(otherToken).digest('hex'), otherUser.rows[0].id],
  );
  const foreign = await fetch(`${BASE}/api/tournaments/${id}`, {
    headers: { cookie: `padel_session=${otherToken}` },
  });
  check("another organiser cannot read someone else's tournament", () =>
    assert.equal(foreign.status, 404));

  console.log('\ncleanup');
  const removed = await api(`/api/tournaments/${id}`, { method: 'DELETE' });
  check('tournament deleted', () => assert.equal(removed.status, 200));
  const gone = await api(`/api/tournaments/${id}`);
  check('deleted tournament is gone', () => assert.equal(gone.status, 404));

  await client.query('DELETE FROM users WHERE id = ANY($1)', [[userId, otherUser.rows[0].id]]);
} finally {
  await client.end();
}

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
