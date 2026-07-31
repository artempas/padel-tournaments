import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extendAmericano,
  generateAmericano,
  totalMatchesFor,
  type PlayedMatch,
} from '../src/lib/americano.ts';

/** Every invariant the tournament screen relies on. */
function checkInvariants(n: number, courts: number, schedule: ReturnType<typeof generateAmericano>) {
  const label = `n=${n}, courts=${courts}`;

  assert.equal(schedule.matches.length, totalMatchesFor(n), `${label}: match count`);

  const byRound = new Map<number, typeof schedule.matches>();
  for (const m of schedule.matches) {
    const all = [...m.team1, ...m.team2];
    assert.equal(new Set(all).size, 4, `${label}: four distinct players per match`);
    for (const p of all) {
      assert.ok(p >= 0 && p < n, `${label}: player index in range`);
    }
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }

  for (const [round, matches] of byRound) {
    // Nobody plays two matches at once.
    const seen = new Set<number>();
    for (const m of matches) {
      for (const p of [...m.team1, ...m.team2]) {
        assert.ok(!seen.has(p), `${label}: player ${p} double-booked in round ${round}`);
        seen.add(p);
      }
    }
    assert.ok(matches.length <= courts, `${label}: round ${round} exceeds court count`);
    assert.equal(
      new Set(matches.map((m) => m.court)).size,
      matches.length,
      `${label}: distinct courts in round ${round}`,
    );
  }

  // Rounds are contiguous and 1-based.
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  assert.deepEqual(rounds, Array.from({ length: rounds.length }, (_, i) => i + 1), `${label}: rounds`);

  // Play time is fair to within one match.
  assert.ok(
    schedule.quality.maxGames - schedule.quality.minGames <= 1,
    `${label}: games spread ${schedule.quality.minGames}..${schedule.quality.maxGames}`,
  );
}

test('schedules are valid for every field size and court count', () => {
  for (let n = 4; n <= 24; n++) {
    for (const courts of [1, 2, 3, 4, 6]) {
      const schedule = generateAmericano(n, courts, { seed: 12345 });
      checkInvariants(n, courts, schedule);
    }
  }
});

test('perfect Americano when n ≡ 0 or 1 (mod 4)', () => {
  for (const n of [4, 5, 8, 9, 12, 13, 16, 17, 20, 21]) {
    const schedule = generateAmericano(n, 4, { seed: 777 });
    assert.equal(
      schedule.quality.missedPartnerships,
      0,
      `n=${n}: ${schedule.quality.missedPartnerships} pairs never partnered`,
    );
    assert.equal(
      schedule.quality.repeatedPartnerships,
      0,
      `n=${n}: ${schedule.quality.repeatedPartnerships} repeated partnerships`,
    );
  }
});

test('near-perfect coverage when a perfect design does not exist', () => {
  // n ≡ 2 or 3 (mod 4): a flawless partner design is mathematically impossible,
  // so allow a small number of gaps rather than pretending otherwise.
  for (const n of [6, 7, 10, 11, 14, 15]) {
    const schedule = generateAmericano(n, 3, { seed: 777 });
    const slack = Math.ceil(n / 4);
    assert.ok(
      schedule.quality.missedPartnerships <= slack,
      `n=${n}: ${schedule.quality.missedPartnerships} missed partnerships (allowed ${slack})`,
    );
  }
});

test('court count caps matches per round', () => {
  const schedule = generateAmericano(16, 2, { seed: 1 });
  assert.equal(schedule.matchesPerRound, 2);
  const perRound = new Map<number, number>();
  for (const m of schedule.matches) perRound.set(m.round, (perRound.get(m.round) ?? 0) + 1);
  for (const count of perRound.values()) assert.ok(count <= 2);
});

test('more courts than the field supports are ignored', () => {
  const schedule = generateAmericano(6, 8, { seed: 1 });
  assert.equal(schedule.matchesPerRound, 1);
});

test('the same seed reproduces the same schedule', () => {
  const a = generateAmericano(8, 2, { seed: 42 });
  const b = generateAmericano(8, 2, { seed: 42 });
  assert.deepEqual(a.matches, b.matches);
});

test('rejects fields that cannot form a match', () => {
  assert.throws(() => generateAmericano(3, 1));
  assert.throws(() => generateAmericano(33, 1));
  assert.throws(() => generateAmericano(8, 0));
});

// ---------------------------------------------------------------------------
// Продление: раунды, дописанные к уже сыгранному расписанию.
// ---------------------------------------------------------------------------

/** Расписание в том виде, в каком его помнит турнир: раунд плюс две пары. */
function asHistory(matches: PlayedMatch[]): PlayedMatch[] {
  return matches.map((m) => ({ round: m.round, team1: m.team1, team2: m.team2 }));
}

function gamesPlayed(n: number, matches: PlayedMatch[]): number[] {
  const games = Array.from({ length: n }, () => 0);
  for (const m of matches) for (const p of [...m.team1, ...m.team2]) games[p]++;
  return games;
}

function partnerCounts(n: number, matches: PlayedMatch[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    for (const pair of [m.team1, m.team2]) {
      const key = [...pair].sort((a, b) => a - b).join('-');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

test('добавленные раунды — полноценные раунды турнира', () => {
  for (const [n, courts] of [
    [8, 2],
    [9, 2],
    [12, 3],
    [16, 4],
  ] as Array<[number, number]>) {
    const base = generateAmericano(n, courts, { seed: 4242 });
    const added = extendAmericano(n, courts, 3, asHistory(base.matches), { seed: 99 });
    const label = `n=${n}, courts=${courts}`;

    assert.equal(added.length, 3 * base.matchesPerRound, `${label}: длина добавки`);
    assert.deepEqual(
      [...new Set(added.map((m) => m.round))].sort((a, b) => a - b),
      [1, 2, 3],
      `${label}: нумерация с единицы`,
    );

    for (const round of [1, 2, 3]) {
      const inRound = added.filter((m) => m.round === round);
      const seats = inRound.flatMap((m) => [...m.team1, ...m.team2]);
      assert.equal(new Set(seats).size, seats.length, `${label}: раунд ${round} без совместителей`);
      assert.equal(
        new Set(inRound.map((m) => m.court)).size,
        inRound.length,
        `${label}: раунд ${round} без двух матчей на корте`,
      );
      for (const p of seats) assert.ok(p >= 0 && p < n, `${label}: игрок из состава`);
    }
  }
});

test('продление не сбивает счёт сыгранных матчей', () => {
  for (const [n, courts] of [
    [8, 2],
    [10, 2],
    [13, 3],
  ] as Array<[number, number]>) {
    const base = generateAmericano(n, courts, { seed: 4242 });
    const history = asHistory(base.matches);
    const added = extendAmericano(n, courts, 4, history, { seed: 7 });

    const games = gamesPlayed(n, [...history, ...added]);
    assert.ok(
      Math.max(...games) - Math.min(...games) <= 1,
      `n=${n}: разброс игр ${Math.min(...games)}..${Math.max(...games)}`,
    );
  }
});

test('добавленные пары повторяют сыгранные как можно реже', () => {
  // Идеальное американо на 8 игроков уже свело каждого с каждым по разу,
  // поэтому новые пары — обязательно повторы. Важно, чтобы повторялись все
  // понемногу, а не одни и те же по три раза.
  const n = 8;
  const base = generateAmericano(n, 2, { seed: 4242 });
  const history = asHistory(base.matches);
  assert.equal(base.quality.repeatedPartnerships, 0);

  const added = extendAmericano(n, 2, 3, history, { seed: 11 });
  const counts = partnerCounts(n, [...history, ...added]);

  for (const [pair, count] of counts) {
    assert.ok(count <= 2, `пара ${pair} сыграла вместе ${count} раза`);
  }
});

test('на корт первыми выходят те, кто меньше играл', () => {
  // Восьмой игрок опоздал и пропустил оба раунда — добавочный раунд обязан
  // взять его: у него меньше всех игр.
  const history: PlayedMatch[] = [
    { round: 1, team1: [1, 2], team2: [3, 4] },
    { round: 2, team1: [5, 6], team2: [7, 1] },
  ];

  const added = extendAmericano(8, 1, 1, history, { seed: 5 });
  assert.equal(added.length, 1);
  assert.ok([...added[0].team1, ...added[0].team2].includes(0));
});

test('одно и то же зерно продлевает одинаково', () => {
  const base = generateAmericano(8, 2, { seed: 42 });
  const history = asHistory(base.matches);
  assert.deepEqual(
    extendAmericano(8, 2, 2, history, { seed: 3 }),
    extendAmericano(8, 2, 2, history, { seed: 3 }),
  );
});

test('продление отвергает бессмыслицу', () => {
  const history = asHistory(generateAmericano(8, 2, { seed: 1 }).matches);
  assert.throws(() => extendAmericano(8, 2, 0, history));
  assert.throws(() => extendAmericano(8, 2, 1.5, history));
  assert.throws(() => extendAmericano(3, 1, 1, []));
  assert.throws(() => extendAmericano(8, 0, 1, history));
  // Игрок, которого нет в составе, — расписание не от этого турнира.
  assert.throws(() => extendAmericano(8, 2, 1, [{ round: 1, team1: [0, 1], team2: [2, 9] }]));
});
