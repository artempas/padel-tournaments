import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCourts, courtConfig, courtNumbers, validateCourts, type CourtConfig } from '../src/lib/courts.ts';
import { americanoSize, generateCourtAmericano, extendCourtAmericano, type CourtMatch } from '../src/lib/court-schedule.ts';
import { generateAmericano, totalMatchesFor } from '../src/lib/americano.ts';
import { firstRound, nextRound, matchesPerRound } from '../src/lib/mexicano.ts';
import { tournamentSize, upcomingRounds } from '../src/lib/formats.ts';
import { computeRatings, matchRatings, ratingHistory } from '../src/lib/rating.ts';
import { computeStandings, restingInRound } from '../src/lib/standings.ts';
import { tournamentInsights } from '../src/lib/insights.ts';
import type { Match } from '../src/lib/types.ts';

function valid(matches: CourtMatch[], n: number, config: CourtConfig) {
  const rounds = new Map<number, Set<number>>();
  const courts = new Set<string>();
  for (const m of matches) {
    assert.ok(m.court >= 1 && m.court <= config.doubles + config.singles);
    assert.equal(m.team1.length, m.court <= config.doubles ? 2 : 1);
    assert.equal(m.team1.length, m.team2.length);
    assert.ok(!courts.has(`${m.round}/${m.court}`));
    courts.add(`${m.round}/${m.court}`);
    const seen = rounds.get(m.round) ?? new Set<number>();
    for (const p of [...m.team1, ...m.team2]) {
      assert.ok(Number.isInteger(p) && p >= 0 && p < n);
      assert.ok(!seen.has(p), `player ${p} double booked in round ${m.round}`);
      seen.add(p);
    }
    rounds.set(m.round, seen);
  }
}

test('court validation, old snapshots and stable physical court numbers', () => {
  assert.deepEqual(courtConfig({ courts: 3 }), { doubles: 3, singles: 0 });
  assert.deepEqual(courtConfig({ courts: 3, singlesCourts: 2 }), { doubles: 1, singles: 2 });
  for (const config of [{ doubles: 0, singles: 0 }, { doubles: -1, singles: 2 },
    { doubles: 1.5, singles: 0 }, { doubles: 10, singles: 7 }, { doubles: 0, singles: NaN }]) {
    assert.throws(() => validateCourts(config));
  }
  assert.deepEqual(activeCourts(6, { doubles: 3, singles: 2 }), { doubles: 1, singles: 1 });
  assert.deepEqual(courtNumbers(6, { doubles: 3, singles: 2 }), [1, 4]);
});

test('singles round robin meets each opponent once for every supported field size', () => {
  for (let n = 2; n <= 32; n++) {
    for (const singles of [1, 2, 5, 16]) {
      const config = { doubles: 0, singles };
      const ms = generateCourtAmericano(n, config, 137);
      valid(ms, n, config);
      const pairs = new Set(ms.map((m) => [m.team1[0], m.team2[0]].sort((a, b) => a - b).join('/')));
      assert.equal(pairs.size, n * (n - 1) / 2);
      assert.equal(ms.length, pairs.size);
      assert.deepEqual(americanoSize(n, config), { matches: ms.length, rounds: Math.max(...ms.map((m) => m.round)) });
      assert.deepEqual(tournamentSize('americano', n, config, null), americanoSize(n, config));
    }
  }
});

test('mixed Americano preserves partnership schedule and preview, including partial final rounds', () => {
  for (const n of [4, 5, 6, 7, 8, 10, 12, 17, 24, 32]) {
    for (const config of [{ doubles: 1, singles: 1 }, { doubles: 3, singles: 2 }]) {
      const ms = generateCourtAmericano(n, config, 137);
      valid(ms, n, config);
      const doubles = ms.filter((m) => m.team1.length === 2);
      assert.equal(doubles.length, totalMatchesFor(n));
      if (n <= 8) {
        const original = generateAmericano(n, activeCourts(n, config).doubles, { seed: 137 });
        assert.deepEqual(doubles, original.matches);
      }
      assert.deepEqual(americanoSize(n, config), { matches: ms.length, rounds: Math.max(...ms.map((m) => m.round)) });
      if (n >= 6) assert.ok(ms.some((m) => m.team1.length === 1));
      const games = Array(n).fill(0) as number[];
      for (const m of ms) for (const p of [...m.team1, ...m.team2]) games[p]++;
      assert.ok(Math.max(...games) - Math.min(...games) <= 1, `uneven rest at n=${n}`);
      const extended = extendCourtAmericano(n, config, 3, ms, 142);
      valid(extended, n, config);
      assert.equal(Math.max(...extended.map((m) => m.round)), 3);
    }
  }
});

test('doubles-only output remains exactly the existing generator', () => {
  assert.deepEqual(generateCourtAmericano(8, { doubles: 2, singles: 0 }, 45),
    generateAmericano(8, 2, { seed: 45 }).matches);
});

test('singles extension uses history and rotates rest', () => {
  const config = { doubles: 0, singles: 1 };
  const history: CourtMatch[] = [{ round: 1, court: 1, team1: [0], team2: [1] }];
  const extra = extendCourtAmericano(4, config, 1, history, 1);
  assert.deepEqual(new Set([...extra[0].team1, ...extra[0].team2]), new Set([2, 3]));
  valid(extra, 4, config);
});

test('Mexicano respects types, court numbers and rests for singles and mixed fields', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 12, 17, 32]) {
    for (const config of [{ doubles: 0, singles: 2 }, { doubles: 2, singles: 1 }]) {
      if (n < 4 && config.doubles > 0) continue;
      const ratings = Array.from({ length: n }, (_, i) => n - i);
      const first = firstRound(ratings, config, 12);
      valid(first.map((m) => ({ ...m, round: 1 })), n, config);
      const rested = Array(n).fill(0) as number[];
      const singles = Array(n).fill(0) as number[];
      for (let i = 0; i < 20; i++) {
        const round = nextRound(rested, config, singles);
        valid(round.map((m) => ({ ...m, round: 1 })), n, config);
        assert.equal(round.length, matchesPerRound(n, config));
        const playing = new Set(round.flatMap((m) => [...m.team1, ...m.team2]));
        rested.forEach((_, p) => { if (!playing.has(p)) rested[p]++; });
        for (const m of round) if (m.team1.length === 1) for (const p of [...m.team1, ...m.team2]) singles[p]++;
      }
      assert.ok(Math.max(...rested) - Math.min(...rested) <= 1);
      if (n >= 6 || config.doubles === 0) assert.ok(Math.max(...singles) - Math.min(...singles) <= 2);
      assert.equal(tournamentSize('mexicano', n, config, 8).matches, 8 * first.length);
      assert.equal(upcomingRounds('mexicano', n, config, 8, 1).length, 7);
    }
  }
  const ranked = firstRound([300, 250, 200, 150], { doubles: 0, singles: 2 });
  assert.deepEqual(ranked, [{ court: 1, team1: [0], team2: [1] }, { court: 2, team1: [2], team2: [3] }]);
});

test('singles contributes once to shared standings, rating and history without a phantom partner', () => {
  const match: Match = { id: 'm', round: 1, court: 1, team1: ['a'], team2: ['b'], score1: 12, score2: 4, skipped: false };
  const players = ['a', 'b', 'c'].map((id, seat) => ({ id, seat, name: id }));
  const board = computeStandings(players, [match]);
  assert.equal(board[0].playerId, 'a');
  assert.equal(board[0].pointsFor, 12);
  assert.deepEqual(restingInRound(players, [match], 1).map((p) => p.id), ['c']);
  const rated = { teamA: ['a'], teamB: ['b'], scoreA: 12, scoreB: 4 };
  const ratings = computeRatings([rated]);
  assert.equal(ratings.size, 2);
  assert.equal(ratings.get('a')!.matches, 1);
  assert.ok(ratings.get('a')!.rating > 100);
  assert.ok(ratings.get('b')!.rating < 100);
  const snapshot = matchRatings([rated])[0]!;
  assert.equal(snapshot.teamA.players.length, 1);
  assert.equal(snapshot.teamA.rating, snapshot.teamA.players[0].rating);
  const history = ratingHistory([{ ...rated, tournamentId: 't', tournamentName: 'T', at: '2026-11-01' }]);
  assert.equal(history.get('a')![0].matches[0].partnerId, null);
  assert.deepEqual(history.get('a')![0].matches[0].opponentIds, ['b']);
  const insights = tournamentInsights(players, Array.from({ length: 5 }, (_, i) => ({ ...match, id: String(i), round: i + 1 })));
  assert.ok(insights.every((i) => !['best-pair', 'chemistry', 'carried'].includes(i.id)));
  assert.ok(!JSON.stringify(insights).includes('undefined'));
});
