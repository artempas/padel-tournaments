/** Singles/mixed API and database regression checks against a local server.
 * node --env-file=.env.local scripts/smoke-courts.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';

const base = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let userId, clubId;
const token = randomBytes(32).toString('base64url');
async function api(path, method = 'GET', body, status = 200) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: `padel_session=${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}
async function create(options) {
  const { id } = await api('/tournaments', 'POST', {
    name: 'Проверка кортов', players: ['Анна', 'Борис', 'Вера', 'Глеб', 'Даша', 'Егор'],
    pointsPerMatch: 16, format: 'americano', ...options,
  }, 201);
  return (await api(`/tournaments/${id}`)).tournament;
}
function checkBoard(t) {
  const busy = new Set();
  for (const m of t.matches) {
    const size = m.court <= t.courts - t.singlesCourts ? 2 : 1;
    assert.equal(m.team1.length, size);
    assert.equal(m.team2.length, size);
    for (const p of [...m.team1, ...m.team2]) {
      assert.ok(!busy.has(`${m.round}/${p}`));
      busy.add(`${m.round}/${p}`);
    }
  }
}
async function rejectsSQL(sql, args) {
  await client.query('BEGIN');
  let rejected = false;
  try {
    await client.query(sql, args);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch { rejected = true; }
  finally { await client.query('ROLLBACK'); }
  assert.ok(rejected, `database must reject ${sql}`);
}

try {
  const username = `courts-${Date.now()}`;
  userId = (await client.query('INSERT INTO users (username, username_key, display_name) VALUES ($1,$1,$1) RETURNING id', [username])).rows[0].id;
  await client.query('BEGIN');
  clubId = (await client.query("INSERT INTO clubs (name, icon, color) VALUES ('Проверка кортов','🎾','lime') RETURNING id")).rows[0].id;
  await client.query('INSERT INTO people (club_id,name,name_key,user_id) VALUES ($1,$2,$2,$3)', [clubId, username, userId]);
  await client.query("INSERT INTO club_members (club_id,user_id,role) VALUES ($1,$2,'owner')", [clubId, userId]);
  await client.query('COMMIT');
  await client.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [createHash('sha256').update(token).digest(), userId]);

  const legacy = await create({ courts: 1 });
  assert.equal(legacy.singlesCourts, 0);
  checkBoard(legacy);
  console.log('ok legacy doubles payload and load');

  const singles = await create({ doublesCourts: 0, singlesCourts: 1, players: ['Анна', 'Борис'] });
  assert.equal(singles.matches.length, 1);
  checkBoard(singles);
  const scored = await api(`/tournaments/${singles.id}/matches/${singles.matches[0].id}`, 'PATCH', { score1: 12, score2: 4 });
  assert.equal(scored.tournament.status, 'finished');
  const roster = await api('/roster');
  assert.ok(roster.players.some((p) => p.name === 'Анна' && p.rating > 100));
  const extended = await api(`/tournaments/${singles.id}/rounds`, 'POST', { rounds: 2 });
  assert.equal(extended.tournament.matches.length, 3);
  assert.equal(extended.tournament.status, 'running');
  checkBoard(extended.tournament);
  console.log('ok two-player singles scoring, rating and extension');

  const mixed = await create({ doublesCourts: 1, singlesCourts: 1 });
  assert.equal(mixed.courts, 2);
  assert.equal(mixed.singlesCourts, 1);
  assert.equal(mixed.matches.length, 16);
  checkBoard(mixed);
  const mixMore = await api(`/tournaments/${mixed.id}/rounds`, 'POST', { rounds: 2 });
  assert.equal(mixMore.tournament.matches.length, 20);
  checkBoard(mixMore.tournament);
  assert.deepEqual(mixMore.tournament.matches.slice(0, mixed.matches.length), mixed.matches);
  console.log('ok mixed Americano creation and extension preserve old matches');

  const scarce = await create({ doublesCourts: 3, singlesCourts: 2 });
  assert.equal(scarce.courts, 5);
  assert.equal(scarce.singlesCourts, 2);
  assert.deepEqual(scarce.matches.filter((m) => m.round === 1).map((m) => m.court), [1, 4]);
  checkBoard(scarce);
  console.log('ok surplus courts saved with stable numbering');

  const mexicano = await create({ doublesCourts: 1, singlesCourts: 1, format: 'mexicano', rounds: 2 });
  assert.equal(mexicano.matches.length, 2);
  checkBoard(mexicano);
  const first = mexicano.matches[0];
  await api(`/tournaments/${mexicano.id}/matches/${first.id}`, 'PATCH', { score1: 8, score2: 8 });
  const second = mexicano.matches[1];
  const skipped = await api(`/tournaments/${mexicano.id}/matches/${second.id}`, 'PATCH', { skipped: true });
  assert.equal(skipped.tournament.matches.length, 4);
  checkBoard(skipped.tournament);
  for (const m of skipped.tournament.matches.filter((m) => m.round === 2)) {
    await api(`/tournaments/${mexicano.id}/matches/${m.id}`, 'PATCH', { score1: 9, score2: 7 });
  }
  assert.equal((await api(`/tournaments/${mexicano.id}`)).tournament.status, 'running');
  const done = await api(`/tournaments/${mexicano.id}/matches/${second.id}`, 'PATCH', { score1: 10, score2: 6 });
  assert.equal(done.tournament.status, 'finished');
  const cleared = await api(`/tournaments/${mexicano.id}/matches/${second.id}`, 'PATCH', { score1: null, score2: null });
  assert.equal(cleared.tournament.status, 'running');
  assert.equal(cleared.tournament.matches.length, 4);
  console.log('ok mixed Mexicano progression, skip, completion and clearing score');

  const list = await api('/tournaments');
  assert.equal(list.tournaments.find((t) => t.id === mixed.id).singlesCourts, 1);
  const repeat = await fetch(`${base}/tournaments/new?from=${mixed.id}`, { headers: { cookie: `padel_session=${token}` } });
  const html = await repeat.text();
  assert.equal(repeat.status, 200);
  assert.ok(html.includes('Корты 1 на 1'));
  assert.match(html, /aria-label="Корты 2 на 2"[^>]*>1</);
  assert.match(html, /aria-label="Корты 1 на 1"[^>]*>1</);
  console.log('ok list and repeat configuration');

  for (const config of [{ doublesCourts: 0, singlesCourts: 0 }, { doublesCourts: -1, singlesCourts: 2 },
    { doublesCourts: 1.5, singlesCourts: 1 }, { doublesCourts: 16, singlesCourts: 1 },
    { doublesCourts: 1, singlesCourts: null }, { doublesCourts: true, singlesCourts: 1 }]) {
    await api('/tournaments', 'POST', { name: 'Неверный', players: ['А', 'Б', 'В', 'Г'], ...config }, 400);
  }
  await api('/tournaments', 'POST', { name: 'Неверный', players: ['А'], doublesCourts: 0, singlesCourts: 1 }, 400);
  await api(`/tournaments/${mixed.id}/matches/${mixed.matches[0].id}`, 'PATCH', { score1: 1, score2: 1 }, 400);
  console.log('ok invalid inputs rejected');

  const singleMatch = mixed.matches.find((m) => m.team1.length === 1);
  const doubleMatch = mixed.matches.find((m) => m.team1.length === 2);
  await rejectsSQL('UPDATE matches SET team_size=2 WHERE id=$1', [singleMatch.id]);
  await rejectsSQL('UPDATE matches SET court_no=3 WHERE id=$1', [singleMatch.id]);
  await rejectsSQL("UPDATE match_participants SET side='a',slot=2 WHERE match_id=$1 AND side='b'", [singleMatch.id]);
  await rejectsSQL("UPDATE match_participants SET slot=2 WHERE match_id=$1 AND side='a'", [singleMatch.id]);
  await rejectsSQL("DELETE FROM match_participants WHERE match_id=$1 AND side='a' AND slot=2", [doubleMatch.id]);
  await rejectsSQL('UPDATE tournaments SET singles_courts=0 WHERE id=$1', [mixed.id]);
  console.log('ok database enforces sizes, sides, court type and immutable configuration');
} finally {
  await client.query('ROLLBACK');
  if (clubId) {
    await client.query('DELETE FROM tournaments WHERE club_id=$1', [clubId]);
    await client.query('DELETE FROM clubs WHERE id=$1', [clubId]);
  }
  if (userId) await client.query('DELETE FROM users WHERE id=$1', [userId]);
  await client.end();
}
