import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAmericano, totalMatchesFor } from '../src/lib/americano.ts';

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
