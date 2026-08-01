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

/**
 * Аккаунт с личным клубом и готовой сессией.
 *
 * Клуб обязателен: ростер и турниры принадлежат ему, и аккаунт без клуба API
 * просто не пустит. Владелец, его игрок и членство пишутся одной транзакцией —
 * порознь их запрещают отложенные триггеры.
 */
async function seedAccount(name) {
  const created = await client.query(
    'INSERT INTO users (username, username_key, display_name) VALUES ($1, $1, $1) RETURNING id',
    [name],
  );
  const id = created.rows[0].id;

  await client.query('BEGIN');
  const club = await client.query(
    "INSERT INTO clubs (name, icon, color) VALUES ($1, '🎾', 'lime') RETURNING id",
    [`Клуб ${name}`.slice(0, 40)],
  );
  await client.query(
    'INSERT INTO people (club_id, name, name_key, user_id) VALUES ($1, $2, $2, $3)',
    [club.rows[0].id, name, id],
  );
  await client.query(
    "INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, 'owner')",
    [club.rows[0].id, id],
  );
  await client.query('COMMIT');

  const sessionToken = randomBytes(32).toString('base64url');
  // token_hash — bytea, поэтому digest() без 'hex'.
  await client.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [createHash('sha256').update(sessionToken).digest(), id],
  );

  return { id, clubId: club.rows[0].id, cookie: `padel_session=${sessionToken}` };
}

const username = `smoke-${Date.now()}`;
const owner = await seedAccount(username);
const userId = owner.id;
const clubId = owner.clubId;
const cookie = owner.cookie;

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

  console.log('\nearly finish');
  // Score two matches, then stop the tournament with the rest unplayed.
  for (const m of detail.matches.slice(0, 2)) {
    await api(`/api/tournaments/${id}/matches/${m.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ score1: 12, score2: 4 }),
    });
  }
  const closed = await api(`/api/tournaments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ closedEarly: true }),
  });
  check('tournament can be finished early', () => {
    assert.equal(closed.status, 200);
    assert.equal(closed.body.tournament.status, 'finished');
    assert.equal(closed.body.tournament.closedEarly, true);
    assert.ok(closed.body.tournament.finishedAt);
  });
  check('unplayed matches keep their empty score', () => {
    const unplayed = closed.body.tournament.matches.filter((m) => m.score1 === null);
    assert.equal(unplayed.length, 12);
  });
  check('the table counts only what was played', () => {
    const total = closed.body.tournament.matches
      .filter((m) => m.score1 !== null)
      .reduce((sum, m) => sum + (m.score1 + m.score2) * 2, 0);
    assert.equal(total, 2 * 16 * 2);
  });

  // The regression that motivates closed_manually: recomputing status after an
  // edit must not silently reopen a tournament the organiser closed.
  const editedWhileClosed = await api(
    `/api/tournaments/${id}/matches/${detail.matches[0].id}`,
    { method: 'PATCH', body: JSON.stringify({ score1: 9, score2: 7 }) },
  );
  check('editing a score does not reopen an early-finished tournament', () => {
    assert.equal(editedWhileClosed.body.tournament.status, 'finished');
    assert.equal(editedWhileClosed.body.tournament.closedEarly, true);
  });

  const listed = (await api('/api/tournaments')).body.tournaments.find((t) => t.id === id);
  check('the list reports it as finished early', () => {
    assert.equal(listed.status, 'finished');
    assert.equal(listed.closedEarly, true);
  });

  const reopened = await api(`/api/tournaments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ closedEarly: false }),
  });
  check('an early-finished tournament can be resumed', () => {
    assert.equal(reopened.body.tournament.status, 'running');
    assert.equal(reopened.body.tournament.closedEarly, false);
    assert.equal(reopened.body.tournament.finishedAt, null);
  });

  const badClose = await api(`/api/tournaments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ closedEarly: 'yes' }),
  });
  check('closedEarly must be a boolean', () => assert.equal(badClose.status, 400));

  // Reset so the completion checks below start from a clean slate.
  for (const m of detail.matches.slice(0, 2)) {
    await api(`/api/tournaments/${id}/matches/${m.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ score1: null, score2: null }),
    });
  }

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

  console.log('\nroster');
  // Свой игрок владельца клуба тоже лежит в ростере — участник клуба это
  // всегда и игрок клуба. Проверки ниже про тех, кого вписали в турнир, так
  // что владельца из выборки убираем.
  const entered = (list) => list.filter((p) => p.name !== username);

  const all = (await api('/api/roster')).body.players;
  check('the club owner is a player of their own club', () =>
    assert.ok(all.some((p) => p.name === username && p.matches === 0)));

  const roster = entered(all);
  check('every entered player is saved to the roster', () =>
    assert.equal(roster.length, players.length));
  check('roster names match what was entered', () =>
    assert.deepEqual([...roster.map((p) => p.name)].sort(), [...players].sort()));

  check('roster totals equal the tournament totals', () => {
    const total = roster.reduce((sum, p) => sum + p.pointsFor, 0);
    assert.equal(total, 14 * 16 * 2);
  });
  check('each player has 7 matches in 1 tournament', () => {
    for (const p of roster) {
      assert.equal(p.matches, 7, `${p.name} has ${p.matches} matches`);
      assert.equal(p.tournaments, 1);
    }
  });

  console.log('\nrepeat with the same players');
  const repeat = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Second run', players, courts: 2, pointsPerMatch: 16 }),
  });
  check('second tournament created', () => assert.equal(repeat.status, 201));
  const secondId = repeat.body.id;

  const afterRepeat = entered((await api('/api/roster')).body.players);
  check('the same names do not duplicate the roster', () =>
    assert.equal(afterRepeat.length, players.length));
  check('roster ids are stable across tournaments', () =>
    assert.deepEqual(
      afterRepeat.map((p) => p.id).sort(),
      roster.map((p) => p.id).sort(),
    ));

  const second = (await api(`/api/tournaments/${secondId}`)).body.tournament;
  for (const m of second.matches) {
    await api(`/api/tournaments/${secondId}/matches/${m.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ score1: 10, score2: 6 }),
    });
  }
  const cumulative = entered((await api('/api/roster')).body.players);
  check('points accumulate across tournaments', () => {
    const total = cumulative.reduce((sum, p) => sum + p.pointsFor, 0);
    assert.equal(total, 14 * 16 * 2 * 2);
  });
  check('tournament count rises to 2', () => {
    for (const p of cumulative) assert.equal(p.tournaments, 2, `${p.name}: ${p.tournaments}`);
  });

  console.log('\ncase-insensitive matching');
  const shouted = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Case test',
      players: players.map((p) => p.toUpperCase()),
      courts: 2,
    }),
  });
  check('a tournament with differently-cased names is accepted', () =>
    assert.equal(shouted.status, 201));
  const afterCase = entered((await api('/api/roster')).body.players);
  check('roster still holds one entry per person', () =>
    assert.equal(afterCase.length, players.length));

  console.log('\nroster deletion');
  const victim = afterCase[0];
  const removedPlayer = await api(`/api/roster/${victim.id}`, { method: 'DELETE' });
  check('roster player deleted', () => assert.equal(removedPlayer.status, 200));
  const afterDelete = entered((await api('/api/roster')).body.players);
  check('player is gone from the roster', () =>
    assert.equal(afterDelete.length, players.length - 1));
  // За игроком владельца стоит аккаунт, и спрятать его нельзя: получился бы
  // участник клуба, которого в клубе не видно.
  const own = all.find((p) => p.name === username);
  const refusedArchive = await api(`/api/roster/${own.id}`, { method: 'DELETE' });
  check('a player with an account behind them cannot be archived', () =>
    assert.equal(refusedArchive.status, 400));

  const survivingTournament = (await api(`/api/tournaments/${secondId}`)).body.tournament;
  check('deleting a roster player keeps played tournaments intact', () => {
    assert.equal(survivingTournament.players.length, players.length);
    assert.equal(survivingTournament.matches.filter((m) => m.score1 !== null).length, 14);
  });

  await api(`/api/tournaments/${secondId}`, { method: 'DELETE' });
  await api(`/api/tournaments/${shouted.body.id}`, { method: 'DELETE' });

  console.log('\nmexicano');
  const badFormat = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', players, courts: 1, format: 'team_americano' }),
  });
  check('rejects a format with no generator', () => assert.equal(badFormat.status, 400));

  const badRounds = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', players, courts: 1, format: 'mexicano', rounds: 0 }),
  });
  check('rejects a round count outside the allowed range', () =>
    assert.equal(badRounds.status, 400));

  const mex = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke Mexicano',
      players,
      courts: 2,
      pointsPerMatch: 16,
      format: 'mexicano',
      rounds: 4,
    }),
  });
  check('mexicano tournament created', () => assert.equal(mex.status, 201));
  const mexId = mex.body.id;

  let mexDetail = (await api(`/api/tournaments/${mexId}`)).body.tournament;
  check('the planned length comes back with the tournament', () => {
    assert.equal(mexDetail.format, 'mexicano');
    assert.equal(mexDetail.roundsPlanned, 4);
  });
  check('only the opening round exists at the start', () =>
    assert.deepEqual([...new Set(mexDetail.matches.map((m) => m.round))], [1]));

  // Точки за раунд подобраны так, чтобы верхняя половина таблицы читалась
  // однозначно, без домысливания порядка внутри равных.
  const pointsFor = new Map(mexDetail.players.map((p) => [p.id, 0]));
  const topFourBefore = [];

  for (let round = 1; round <= 4; round++) {
    const matches = mexDetail.matches.filter((m) => m.round === round);
    assert.equal(matches.length, 2, `round ${round} should fill both courts`);

    let response;
    for (const [index, m] of matches.entries()) {
      const score1 = 16 - index * 2;
      response = await api(`/api/tournaments/${mexId}/matches/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ score1, score2: 16 - score1 }),
      });
      assert.equal(response.status, 200, `scoring round ${round}, court ${m.court} failed`);
      for (const p of m.team1) pointsFor.set(p, pointsFor.get(p) + score1);
      for (const p of m.team2) pointsFor.set(p, pointsFor.get(p) + (16 - score1));
    }

    mexDetail = response.body.tournament;

    // Кто по очкам обязан оказаться на первом корте следующего раунда.
    const ordered = [...pointsFor.entries()].sort((a, b) => b[1] - a[1]);
    topFourBefore.push(new Set(ordered.slice(0, 4).map(([id]) => id)));

    if (round < 4) {
      check(`round ${round + 1} appears once round ${round} is scored`, () => {
        assert.equal(mexDetail.matches.filter((m) => m.round === round + 1).length, 2);
        assert.equal(mexDetail.status, 'running');
      });
      check(`round ${round + 1} puts the leading four on court 1`, () => {
        const court1 = mexDetail.matches.find((m) => m.round === round + 1 && m.court === 1);
        assert.deepEqual(
          new Set([...court1.team1, ...court1.team2]),
          topFourBefore[round - 1],
        );
      });
      check(`round ${round + 1} pairs nobody twice`, () => {
        const seats = mexDetail.matches
          .filter((m) => m.round === round + 1)
          .flatMap((m) => [...m.team1, ...m.team2]);
        assert.equal(new Set(seats).size, seats.length);
      });
    }
  }

  check('no round is generated past the planned length', () =>
    assert.equal(new Set(mexDetail.matches.map((m) => m.round)).size, 4));
  check('the tournament finishes with the last planned round', () => {
    assert.equal(mexDetail.status, 'finished');
    assert.equal(mexDetail.closedEarly, false);
    assert.ok(mexDetail.finishedAt);
  });
  const mexListed = (await api('/api/tournaments')).body.tournaments.find((t) => t.id === mexId);
  check('the list carries the format and its planned length', () => {
    assert.equal(mexListed.format, 'mexicano');
    assert.equal(mexListed.roundsPlanned, 4);
    assert.equal(mexListed.matchCount, 8);
    assert.equal(mexListed.playedCount, 8);
  });

  console.log('\nisolation');
  const stranger = await seedAccount(`${username}-other`);
  const foreign = await fetch(`${BASE}/api/tournaments/${id}`, {
    headers: { cookie: stranger.cookie },
  });
  check('a tournament of another club is not readable', () =>
    assert.equal(foreign.status, 404));

  console.log('\nclub roles');
  // Гость приходит по ссылке-приглашению и называется одним из игроков клуба —
  // тем самым, что уже играл в турнире выше. Дальше проверяется ровно то, что
  // отличает участника от администратора.
  const guest = await seedAccount(`${username}-guest`);
  const guestApi = (path, init = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie: guest.cookie, ...(init.headers ?? {}) },
    }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));

  // Отдельный, ещё не доигранный турнир: у завершённого участник счёт менять
  // не вправе, и на нём проверялось бы не то правило.
  const live = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Live americano', players, courts: 2, pointsPerMatch: 16 }),
  });
  const liveId = live.body.id;

  const invited = await api(`/api/clubs/${clubId}/invite`, { method: 'POST' });
  check('invite link issued', () => assert.equal(invited.status, 201));
  const inviteToken = invited.body.invite?.token;

  const preview = await guestApi(`/api/invites/${inviteToken}`);
  check('invite shows the club and its free players', () => {
    assert.equal(preview.body.club?.id, clubId);
    assert.ok(preview.body.free.length > 0);
  });

  // Первый игрок турнира: у него точно есть матчи, и счёт в них гость должен
  // получить право вносить.
  const mine = preview.body.free.find((p) => p.name === 'Артём') ?? preview.body.free[0];
  const joined = await guestApi(`/api/invites/${inviteToken}`, {
    method: 'POST',
    body: JSON.stringify({ personId: mine.id }),
  });
  check('guest joins the club as that player', () => assert.equal(joined.status, 200));

  const seenByGuest = await guestApi(`/api/tournaments/${liveId}`);
  check('a member sees every tournament of the club', () =>
    assert.equal(seenByGuest.status, 200));

  const guestCreate = await guestApi('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Не выйдет', players, courts: 2 }),
  });
  check('a member cannot create a tournament', () => assert.equal(guestCreate.status, 403));

  const guestClose = await guestApi(`/api/tournaments/${liveId}`, {
    method: 'PATCH',
    body: JSON.stringify({ closedEarly: true }),
  });
  check('a member cannot finish a tournament', () => assert.equal(guestClose.status, 403));

  const guestDelete = await guestApi(`/api/tournaments/${liveId}`, { method: 'DELETE' });
  check('a member cannot delete a tournament', () => assert.equal(guestDelete.status, 403));

  const board = seenByGuest.body.tournament;
  const mySeat = board.players.find((p) => p.name === mine.name);
  const ownMatch = board.matches.find(
    (m) => [...m.team1, ...m.team2].includes(mySeat.id),
  );
  const otherMatch = board.matches.find(
    (m) => ![...m.team1, ...m.team2].includes(mySeat.id),
  );

  const ownScore = await guestApi(`/api/tournaments/${liveId}/matches/${ownMatch.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ score1: 9, score2: 7 }),
  });
  check('a member scores a match they play in', () => assert.equal(ownScore.status, 200));

  if (otherMatch) {
    const foreignScore = await guestApi(`/api/tournaments/${liveId}/matches/${otherMatch.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ score1: 9, score2: 7 }),
    });
    check("a member cannot score someone else's match", () =>
      assert.equal(foreignScore.status, 403));
  }

  const promoted = await api(`/api/clubs/${clubId}/members/${guest.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'admin' }),
  });
  check('owner promotes a member to admin', () => assert.equal(promoted.status, 200));

  const asAdmin = await guestApi(`/api/tournaments/${liveId}`, {
    method: 'PATCH',
    body: JSON.stringify({ closedEarly: true }),
  });
  check('an admin finishes the tournament early', () => assert.equal(asAdmin.status, 200));
  await guestApi(`/api/tournaments/${liveId}`, {
    method: 'PATCH',
    body: JSON.stringify({ closedEarly: false }),
  });

  const selfPromote = await guestApi(`/api/clubs/${clubId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'member' }),
  });
  check('an admin cannot demote the owner', () => assert.equal(selfPromote.status, 403));

  const left = await guestApi(`/api/clubs/${clubId}/membership`, { method: 'DELETE' });
  check('a member leaves the club', () => assert.equal(left.status, 200));

  const afterLeaving = await guestApi(`/api/tournaments/${liveId}`);
  check('leaving takes the tournaments away', () => assert.equal(afterLeaving.status, 404));

  const freedAgain = await client.query(
    'SELECT user_id FROM people WHERE id = $1',
    [mine.id],
  );
  check('the player stays in the roster, anonymous again', () =>
    assert.equal(freedAgain.rows[0].user_id, null));

  const ownerLeaves = await api(`/api/clubs/${clubId}/membership`, { method: 'DELETE' });
  check('the owner cannot leave their own club', () => assert.equal(ownerLeaves.status, 400));

  console.log('\ncleanup');
  const removed = await api(`/api/tournaments/${id}`, { method: 'DELETE' });
  check('tournament deleted', () => assert.equal(removed.status, 200));
  const gone = await api(`/api/tournaments/${id}`);
  check('deleted tournament is gone', () => assert.equal(gone.status, 404));

  // Турниры сносим первыми: tournament_players держит people через RESTRICT,
  // и при удалении клуба порядок каскадов не определён.
  const clubs = [clubId, stranger.clubId];
  const accounts = [userId, stranger.id, guest.id];
  await client.query('DELETE FROM tournaments WHERE club_id = ANY($1)', [clubs]);
  await client.query('DELETE FROM clubs WHERE id = ANY($1)', [clubs]);
  await client.query('DELETE FROM clubs WHERE id = $1', [guest.clubId]);
  await client.query('DELETE FROM users WHERE id = ANY($1)', [accounts]);
} finally {
  await client.end();
}

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
