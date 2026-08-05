import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRound, matchesPerRound, nextRound, type RoundMatch } from '../src/lib/mexicano.ts';

/** Everything a round has to satisfy before it can go on a screen. */
function checkRound(round: RoundMatch[], playerCount: number, courts: number, label: string) {
  assert.equal(round.length, matchesPerRound(playerCount, courts), `${label}: courts used`);

  const seen = new Set<number>();
  for (const m of round) {
    const all = [...m.team1, ...m.team2];
    assert.equal(new Set(all).size, 4, `${label}: four distinct players per match`);
    for (const p of all) {
      assert.ok(p >= 0 && p < playerCount, `${label}: index ${p} in range`);
      assert.ok(!seen.has(p), `${label}: player ${p} double-booked`);
      seen.add(p);
    }
  }

  assert.deepEqual(
    round.map((m) => m.court),
    Array.from({ length: round.length }, (_, i) => i + 1),
    `${label}: courts numbered from 1`,
  );
}

/** Рейтинги, все разные: посев тогда определён однозначно. */
function ratings(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 + i);
}

test('rounds are valid for every field size and court count', () => {
  for (let n = 4; n <= 24; n++) {
    for (const courts of [1, 2, 3, 4, 6]) {
      const label = `n=${n}, courts=${courts}`;
      checkRound(firstRound(ratings(n), courts, 12345), n, courts, `first, ${label}`);
      checkRound(nextRound(new Array(n).fill(0), courts), n, courts, `next, ${label}`);
    }
  }
});

test('the opening round is seeded by rating', () => {
  //          seat: 0    1    2   3    4   5    6    7
  const round = firstRound([100, 150, 120, 90, 130, 80, 110, 140], 2, 7);

  // Порядок посева: 1, 7, 4, 2 | 6, 0, 3, 5 — и внутри четвёрки 1-й с 4-м.
  assert.deepEqual(round[0], { court: 1, team1: [1, 2], team2: [7, 4] });
  assert.deepEqual(round[1], { court: 2, team1: [6, 5], team2: [0, 3] });
});

test('the weakest sit out the opening round when the field is not a multiple of four', () => {
  const round = firstRound([50, 10, 40, 20, 30], 1, 3);
  const playing = new Set([...round[0].team1, ...round[0].team2]);

  assert.deepEqual([...playing].sort(), [0, 2, 3, 4]);
});

test('equal ratings are separated by the draw, not by seat order', () => {
  // Новый клуб: рейтинга ни у кого нет, и порядок ввода не должен решать
  // ничего — иначе список, введённый по силе, сложил бы первый корт.
  const openings = new Set<string>();
  for (let seed = 0; seed < 30; seed++) {
    openings.add(JSON.stringify(firstRound(new Array(8).fill(100), 2, seed)));
  }
  assert.ok(openings.size > 1, 'the draw ignores the seed');
});

test('the leading four meet on court 1, paired 1+4 against 2+3', () => {
  // Everyone has sat out the same number of rounds, so nobody is owed a rest
  // and the table order carries straight through to the courts.
  const round = nextRound([1, 1, 1, 1, 1, 1, 1, 1], 2);

  assert.deepEqual(round[0], { court: 1, team1: [0, 3], team2: [1, 2] });
  assert.deepEqual(round[1], { court: 2, team1: [4, 7], team2: [5, 6] });
});

test('players who have sat out least go to the bench', () => {
  // Пятеро на одном корте, один садится: лидер, который ещё не отдыхал.
  // Скамейка раздаётся по времени на ней, а не по месту в таблице, — иначе
  // пропустивший раунд не смог бы его добрать.
  const round = nextRound([0, 1, 1, 1, 1], 1);
  const playing = new Set([...round[0].team1, ...round[0].team2]);

  assert.deepEqual([...playing].sort(), [1, 2, 3, 4]);
});

test('among equals the lower half of the table rests', () => {
  const round = nextRound([0, 0, 0, 0, 0], 1);
  const playing = new Set([...round[0].team1, ...round[0].team2]);

  assert.deepEqual([...playing].sort(), [0, 1, 2, 3]);
});

test('rest keeps circulating over a full tournament', () => {
  // Six players on one court: two rest every round, so after three rounds
  // everyone should have sat out exactly once.
  const rested = new Array(6).fill(0);
  // Places never change here — the point is only who gets the seats.
  for (let round = 0; round < 3; round++) {
    const matches = nextRound(rested, 1);
    const playing = new Set([...matches[0].team1, ...matches[0].team2]);
    for (let p = 0; p < rested.length; p++) if (!playing.has(p)) rested[p]++;
  }

  assert.deepEqual(rested, [1, 1, 1, 1, 1, 1]);
});

test('courts beyond what the field can fill are ignored', () => {
  assert.equal(firstRound(ratings(6), 8, 1).length, 1);
  assert.equal(nextRound(new Array(6).fill(0), 8).length, 1);
});

test('the same seed reproduces the same opening round', () => {
  assert.deepEqual(firstRound(new Array(12).fill(100), 3, 42), firstRound(new Array(12).fill(100), 3, 42));
});

test('rejects fields that cannot form a match', () => {
  assert.throws(() => firstRound(ratings(3), 1));
  assert.throws(() => firstRound(ratings(33), 1));
  assert.throws(() => firstRound(ratings(8), 0));
  assert.throws(() => nextRound([0, 0, 0], 1));
});
