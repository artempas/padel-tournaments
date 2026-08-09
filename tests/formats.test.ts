import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitsScore, tournamentSize, upcomingRounds } from '../src/lib/formats.ts';
import type { Match } from '../src/lib/types.ts';

function match(over: Partial<Match> = {}): Match {
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

test('раунд ждёт матч без счёта, но не пропущенный', () => {
  assert.equal(awaitsScore(match()), true);
  assert.equal(awaitsScore(match({ score1: 10, score2: 6 })), false);
  // Ради этого отметка и заводилась: пропущенный матч не держит раунд, и
  // следующий собирается, хотя счёта здесь по-прежнему нет.
  assert.equal(awaitsScore(match({ skipped: true })), false);
});

test('внесённый счёт закрывает вопрос независимо от отметки', () => {
  // Такого состояния база не допускает (CHECK matches_skipped_unplayed), но
  // правило не должно зависеть от того, кто и в каком порядке снял отметку.
  assert.equal(awaitsScore(match({ score1: 8, score2: 8, skipped: true })), false);
});

test('у американо расписание известно целиком — впереди ничего не висит', () => {
  assert.deepEqual(upcomingRounds('americano', 8, 2, null, 0), []);
  assert.deepEqual(upcomingRounds('americano', 8, 2, null, 3), []);
});

test('у мексикано впереди все раунды, которых ещё нет', () => {
  assert.deepEqual(upcomingRounds('mexicano', 8, 2, 4, 1), [
    { round: 2, matches: 2 },
    { round: 3, matches: 2 },
    { round: 4, matches: 2 },
  ]);
});

test('кортов у будущего раунда столько же, сколько у сыгранных', () => {
  // Девять игроков на трёх кортах — заполняются два, девятый отдыхает.
  const pending = upcomingRounds('mexicano', 9, 3, 3, 0);
  assert.equal(pending.length, 3);
  for (const round of pending) assert.equal(round.matches, 2);
});

test('после последнего раунда впереди пусто', () => {
  assert.deepEqual(upcomingRounds('mexicano', 8, 2, 4, 4), []);
  assert.deepEqual(upcomingRounds('mexicano', 8, 2, 4, 5), []);
});

test('продлённое американо длиннее, чем «каждый с каждым»', () => {
  // 8 игроков — 14 матчей; после двух добавленных раундов их 18, и прогресс
  // должен считаться от восемнадцати, а не показывать 18/14.
  assert.equal(tournamentSize('americano', 8, 2, null).matches, 14);
  assert.equal(tournamentSize('americano', 8, 2, null, 18).matches, 18);
  assert.equal(tournamentSize('americano', 8, 2, null, 18).rounds, 9);
});

test('созданное короче запланированного длину турнира не укорачивает', () => {
  // У мексикано матчей в базе всегда меньше итога — граница снизу молчит.
  assert.equal(tournamentSize('mexicano', 8, 2, 6, 4).matches, 12);
  assert.equal(tournamentSize('americano', 8, 2, null, 4).matches, 14);
});

test('видимое расписание сходится с длиной турнира', () => {
  for (const players of [4, 8, 9, 13, 16]) {
    for (const courts of [1, 2, 3]) {
      for (const planned of [1, 5, 12]) {
        const built = 0;
        const pending = upcomingRounds('mexicano', players, courts, planned, built);
        const shown = pending.reduce((sum, r) => sum + r.matches, 0);
        assert.equal(
          shown,
          tournamentSize('mexicano', players, courts, planned).matches,
          `players=${players}, courts=${courts}, rounds=${planned}`,
        );
      }
    }
  }
});
