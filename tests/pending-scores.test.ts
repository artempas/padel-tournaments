import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPendingScores,
  changedMatches,
  type PendingScore,
} from '../src/lib/pending-scores.ts';
import type { Match, TournamentDetail } from '../src/lib/types.ts';

function match(over: Partial<Match>): Match {
  return {
    id: 'm1',
    round: 1,
    court: 1,
    team1: ['a', 'b'],
    team2: ['c', 'd'],
    score1: null,
    score2: null,
    skipped: false,
    ...over,
  };
}

function tournament(over: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: 't1',
    name: 'Пятничный американо',
    courts: 1,
    format: 'americano',
    roundsPlanned: null,
    pointsPerMatch: 16,
    status: 'running',
    closedEarly: false,
    createdAt: '2026-07-01T18:00:00.000Z',
    finishedAt: null,
    players: [
      { id: 'a', name: 'Аня', seat: 0 },
      { id: 'b', name: 'Боря', seat: 1 },
      { id: 'c', name: 'Вика', seat: 2 },
      { id: 'd', name: 'Гена', seat: 3 },
    ],
    matches: [match({ id: 'm1' }), match({ id: 'm2', round: 2 })],
    ratingBefore: {},
    ...over,
  };
}

function pending(over: Partial<PendingScore>): PendingScore {
  return { tournamentId: 't1', matchId: 'm1', score1: 10, score2: 6, queuedAt: 1, ...over };
}

test('a queued score shows up on its match and nowhere else', () => {
  const result = applyPendingScores(tournament(), [pending({})]);

  assert.deepEqual(
    result.matches.map((m) => [m.id, m.score1, m.score2]),
    [
      ['m1', 10, 6],
      ['m2', null, null],
    ],
  );
});

test('nothing queued leaves the tournament untouched', () => {
  const server = tournament();
  assert.equal(applyPendingScores(server, []), server);
});

test('scores queued for another tournament are ignored', () => {
  const result = applyPendingScores(tournament(), [pending({ tournamentId: 'other' })]);
  assert.equal(result.matches[0].score1, null);
});

test('the newest entry for a match wins', () => {
  const result = applyPendingScores(tournament(), [
    pending({ queuedAt: 2, score1: 9, score2: 7 }),
    pending({ queuedAt: 1, score1: 16, score2: 0 }),
  ]);

  assert.equal(result.matches[0].score1, 9);
});

test('scoring the last match finishes the tournament without the server', () => {
  const server = tournament({ matches: [match({ id: 'm1', score1: 11, score2: 5 })] });
  const result = applyPendingScores(server, [pending({})]);

  assert.equal(server.status, 'running');
  assert.equal(result.status, 'finished');
});

test('a mexicano round ending is not the tournament ending', () => {
  // Раунд 2 из 4 доигран, раунда 3 на устройстве ещё нет — он появится только
  // с сервера. Без этой проверки последний счёт каждого раунда объявлял бы
  // турнир завершённым и выбрасывал организатора в итоговую таблицу.
  const server = tournament({
    format: 'mexicano',
    roundsPlanned: 4,
    matches: [match({ id: 'm1', score1: 11, score2: 5 }), match({ id: 'm2', round: 2 })],
  });
  const result = applyPendingScores(server, [pending({ matchId: 'm2' })]);

  assert.equal(result.matches[1].score1, 10, 'the score itself still lands');
  assert.equal(result.status, 'running');
});

test('a mexicano ends when the last planned round is scored', () => {
  const server = tournament({
    format: 'mexicano',
    roundsPlanned: 2,
    matches: [match({ id: 'm1', score1: 11, score2: 5 }), match({ id: 'm2', round: 2 })],
  });
  const result = applyPendingScores(server, [pending({ matchId: 'm2' })]);

  assert.equal(result.status, 'finished');
});

test('clearing a score puts a finished tournament back in play', () => {
  const server = tournament({
    status: 'finished',
    finishedAt: '2026-07-01T20:00:00.000Z',
    matches: [match({ id: 'm1', score1: 11, score2: 5 })],
  });
  const result = applyPendingScores(server, [pending({ score1: null, score2: null })]);

  assert.equal(result.status, 'running');
  assert.equal(result.finishedAt, null);
});

test('a queued score takes the skipped mark off its match', () => {
  // Внести счёт в отложенный матч — это и значит «вернуться к нему», и видно
  // это должно быть сразу, а не после ответа сервера (там же — setMatchScore).
  const server = tournament({
    format: 'mexicano',
    roundsPlanned: 2,
    matches: [match({ id: 'm1', skipped: true }), match({ id: 'm2', round: 2 })],
  });
  const result = applyPendingScores(server, [pending({ matchId: 'm1' })]);

  assert.equal(result.matches[0].skipped, false);
  assert.equal(result.matches[0].score1, 10);
});

test('a skipped match leaves the tournament unfinished', () => {
  // Пропуск — это «вернёмся позже», а не «матча не было»: счёта у него нет,
  // значит турнир недоигран. Тот же ответ даёт сервер в refreshCompletion.
  const server = tournament({
    format: 'mexicano',
    roundsPlanned: 2,
    matches: [match({ id: 'm1', skipped: true }), match({ id: 'm2', round: 2 })],
  });
  const result = applyPendingScores(server, [pending({ matchId: 'm2' })]);

  assert.equal(result.matches[0].skipped, true, 'чужой счёт отметку не трогает');
  assert.equal(result.status, 'running');
});

test('a tournament closed by hand stays finished with matches left unplayed', () => {
  const server = tournament({ status: 'finished', closedEarly: true });
  const result = applyPendingScores(server, [pending({})]);

  assert.equal(result.status, 'finished');
  assert.equal(result.matches[1].score1, null);
});

test('changedMatches находит матч с новым счётом', () => {
  const before = tournament();
  const after = tournament({
    matches: [match({ id: 'm1', score1: 10, score2: 6 }), match({ id: 'm2', round: 2 })],
  });

  assert.deepEqual(
    changedMatches(before, after).map((m) => m.id),
    ['m1'],
  );
});

test('changedMatches замечает и отметку «пропущен»', () => {
  const before = tournament();
  const after = tournament({
    matches: [match({ id: 'm1', skipped: true }), match({ id: 'm2', round: 2 })],
  });

  assert.deepEqual(
    changedMatches(before, after).map((m) => m.id),
    ['m1'],
  );
});

test('changedMatches ничего не находит в одинаковых снимках', () => {
  assert.deepEqual(changedMatches(tournament(), tournament()), []);
});

test('changedMatches не считает изменением появившийся матч', () => {
  // Следующий раунд мексикано — это не «обновился счёт», и подсвечивать в нём
  // нечего.
  const after = tournament({
    matches: [
      match({ id: 'm1' }),
      match({ id: 'm2', round: 2 }),
      match({ id: 'm3', round: 3, score1: 9, score2: 7 }),
    ],
  });

  assert.deepEqual(changedMatches(tournament(), after), []);
});
