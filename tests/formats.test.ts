import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tournamentSize, upcomingRounds } from '../src/lib/formats.ts';

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
