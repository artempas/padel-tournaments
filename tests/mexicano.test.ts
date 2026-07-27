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

test('rounds are valid for every field size and court count', () => {
  for (let n = 4; n <= 24; n++) {
    for (const courts of [1, 2, 3, 4, 6]) {
      const label = `n=${n}, courts=${courts}`;
      checkRound(firstRound(n, courts, 12345), n, courts, `first, ${label}`);
      checkRound(nextRound(new Array(n).fill(0), courts), n, courts, `next, ${label}`);
    }
  }
});

test('the leading four meet on court 1, paired 1+4 against 2+3', () => {
  // Everyone has played the same number of matches, so nobody is owed a rest
  // and the table order carries straight through to the courts.
  const round = nextRound([1, 1, 1, 1, 1, 1, 1, 1], 2);

  assert.deepEqual(round[0], { court: 1, team1: [0, 3], team2: [1, 2] });
  assert.deepEqual(round[1], { court: 2, team1: [4, 7], team2: [5, 6] });
});

test('players with the most matches behind them sit out', () => {
  // Five players, one court, so one rests: the leader, who has played most.
  // Rest is owed by court time, not by place — otherwise a player who missed
  // a round could never catch up.
  const round = nextRound([2, 1, 1, 1, 1], 1);
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
  const played = new Array(6).fill(0);
  // Places never change here — the point is only who gets the seats.
  for (let round = 0; round < 3; round++) {
    const matches = nextRound(played, 1);
    for (const p of [...matches[0].team1, ...matches[0].team2]) played[p]++;
  }

  assert.deepEqual(played, [2, 2, 2, 2, 2, 2]);
});

test('courts beyond what the field can fill are ignored', () => {
  assert.equal(firstRound(6, 8, 1).length, 1);
  assert.equal(nextRound(new Array(6).fill(0), 8).length, 1);
});

test('the same seed reproduces the same opening round', () => {
  assert.deepEqual(firstRound(12, 3, 42), firstRound(12, 3, 42));
});

test('the opening round is a genuine draw', () => {
  // Seat order must not decide the first court, or entering players in
  // strength order would stack it.
  const openings = new Set<string>();
  for (let seed = 0; seed < 30; seed++) {
    openings.add(JSON.stringify(firstRound(8, 2, seed)));
  }
  assert.ok(openings.size > 1, 'the draw ignores the seed');
});

test('rejects fields that cannot form a match', () => {
  assert.throws(() => firstRound(3, 1));
  assert.throws(() => firstRound(33, 1));
  assert.throws(() => firstRound(8, 0));
  assert.throws(() => nextRound([0, 0, 0], 1));
});
