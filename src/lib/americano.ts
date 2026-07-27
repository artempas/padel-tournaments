/**
 * Americano schedule generator.
 *
 * Format rules:
 *  - every match is 2 vs 2;
 *  - ideally every player partners every other player exactly once
 *    ("каждый с каждым"), which needs ceil(C(n,2) / 2) matches;
 *  - a player never appears twice in the same round, so several courts can
 *    run in parallel;
 *  - when n is not a multiple of 4 some players rest each round — rest is
 *    spread as evenly as the schedule allows.
 *
 * A perfect design only exists for n ≡ 0 or 1 (mod 4). For every other n we
 * search for the best approximation: randomised greedy construction plus
 * local search, repeated many times, keeping the lowest-cost schedule.
 */

// Расширение указано намеренно: тесты грузит node --test напрямую, без
// сборщика, и разрешать './rng' по-бандлерски там некому.
import { mulberry32, shuffle } from './rng.ts';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 32;
export const MAX_COURTS = 16;

export interface ScheduledMatch {
  /** 1-based */
  round: number;
  /** 1-based */
  court: number;
  /** indices into the player array */
  team1: [number, number];
  team2: [number, number];
}

export interface ScheduleQuality {
  /** pairs that never get to play together (0 = perfect Americano) */
  missedPartnerships: number;
  /** partnerships played more than once, counted with multiplicity */
  repeatedPartnerships: number;
  minGames: number;
  maxGames: number;
}

export interface Schedule {
  matches: ScheduledMatch[];
  rounds: number;
  matchesPerRound: number;
  quality: ScheduleQuality;
}

// A repeated partnership is far worse than a repeated opponent.
const PARTNER_W = 1000;
const OPPONENT_W = 3;

interface State {
  n: number;
  partner: Int32Array; // n*n symmetric
  opponent: Int32Array; // n*n symmetric
  games: Int32Array;
  rest: Int32Array; // consecutive rounds spent resting
}

function createState(n: number): State {
  return {
    n,
    partner: new Int32Array(n * n),
    opponent: new Int32Array(n * n),
    games: new Int32Array(n),
    rest: new Int32Array(n),
  };
}

type Quad = [number, number, number, number]; // [t1a, t1b, t2a, t2b]

function quadCost(s: State, q: Quad): number {
  const { n, partner, opponent } = s;
  const [a, b, c, d] = q;
  const p1 = partner[a * n + b];
  const p2 = partner[c * n + d];
  const opp =
    opponent[a * n + c] + opponent[a * n + d] + opponent[b * n + c] + opponent[b * n + d];
  return PARTNER_W * (p1 * p1 + p2 * p2) + OPPONENT_W * opp;
}

function commit(s: State, q: Quad): void {
  const { n, partner, opponent, games } = s;
  const [a, b, c, d] = q;
  partner[a * n + b]++;
  partner[b * n + a]++;
  partner[c * n + d]++;
  partner[d * n + c]++;
  for (const x of [a, b]) {
    for (const y of [c, d]) {
      opponent[x * n + y]++;
      opponent[y * n + x]++;
    }
  }
  games[a]++;
  games[b]++;
  games[c]++;
  games[d]++;
}

/**
 * Pick which players take the court this round: fewest games first, then
 * whoever has been resting longest, with a little noise to break ties.
 */
function pickPool(s: State, need: number, rng: () => number): number[] {
  const order = Array.from({ length: s.n }, (_, i) => i);
  const key = order.map((i) => s.games[i] * 1000 - s.rest[i] * 10 + rng() * 5);
  order.sort((x, y) => key[x] - key[y]);
  return order.slice(0, need);
}

/** Greedy: repeatedly take an anchor player and find their cheapest foursome. */
function buildRoundGreedy(s: State, pool: number[], rng: () => number): Quad[] {
  const avail = shuffle(pool, rng);
  const quads: Quad[] = [];

  while (avail.length >= 4) {
    const a = avail.shift()!;
    let best: Quad | null = null;
    let bestCost = Infinity;

    for (let bi = 0; bi < avail.length; bi++) {
      for (let ci = 0; ci < avail.length; ci++) {
        if (ci === bi) continue;
        for (let di = ci + 1; di < avail.length; di++) {
          if (di === bi) continue;
          const q: Quad = [a, avail[bi], avail[ci], avail[di]];
          const cost = quadCost(s, q) + rng() * 0.01;
          if (cost < bestCost) {
            bestCost = cost;
            best = q;
          }
        }
      }
    }

    const [, b, c, d] = best!;
    quads.push(best!);
    for (const x of [b, c, d]) avail.splice(avail.indexOf(x), 1);
  }

  return quads;
}

function roundCost(s: State, quads: Quad[]): number {
  let total = 0;
  for (const q of quads) total += quadCost(s, q);
  return total;
}

/**
 * Local search: try swapping every pair of seats in the round (across matches
 * and between teams of the same match) and keep any swap that lowers the cost.
 */
function improveRound(s: State, quads: Quad[]): void {
  const seats: Array<[number, number]> = [];
  for (let m = 0; m < quads.length; m++) {
    for (let p = 0; p < 4; p++) seats.push([m, p]);
  }

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const [mi, pi] = seats[i];
        const [mj, pj] = seats[j];
        // Swapping the two seats of the same team is a no-op.
        if (mi === mj && Math.floor(pi / 2) === Math.floor(pj / 2)) continue;

        const before = quadCost(s, quads[mi]) + (mi === mj ? 0 : quadCost(s, quads[mj]));
        const tmp = quads[mi][pi];
        quads[mi][pi] = quads[mj][pj];
        quads[mj][pj] = tmp;
        const after = quadCost(s, quads[mi]) + (mi === mj ? 0 : quadCost(s, quads[mj]));

        if (after < before) {
          improved = true;
        } else {
          const back = quads[mi][pi];
          quads[mi][pi] = quads[mj][pj];
          quads[mj][pj] = back;
        }
      }
    }
  }
}

function buildSchedule(
  n: number,
  matchesPerRound: number,
  totalMatches: number,
  rng: () => number,
  restarts: number,
): { matches: ScheduledMatch[]; state: State } {
  const s = createState(n);
  const matches: ScheduledMatch[] = [];
  let round = 0;

  while (matches.length < totalMatches) {
    round++;
    const m = Math.min(matchesPerRound, totalMatches - matches.length);
    const pool = pickPool(s, m * 4, rng);

    let bestQuads: Quad[] | null = null;
    let bestCost = Infinity;
    for (let r = 0; r < restarts; r++) {
      const quads = buildRoundGreedy(s, pool, rng);
      improveRound(s, quads);
      const cost = roundCost(s, quads);
      if (cost < bestCost) {
        bestCost = cost;
        bestQuads = quads;
      }
      if (cost === 0) break;
    }

    const quads = bestQuads!;
    const playing = new Set<number>();
    quads.forEach((q, i) => {
      commit(s, q);
      q.forEach((p) => playing.add(p));
      matches.push({
        round,
        court: i + 1,
        team1: [q[0], q[1]],
        team2: [q[2], q[3]],
      });
    });

    for (let i = 0; i < n; i++) s.rest[i] = playing.has(i) ? 0 : s.rest[i] + 1;
  }

  return { matches, state: s };
}

/**
 * Global cost of a partner/opponent distribution.
 *
 * The totals are fixed by the number of matches, so a sum of squares is
 * minimised exactly when the counts are spread evenly: `(c-1)²` pushes every
 * partnership towards exactly one, and `c²` spreads opponents around.
 */
function partnerPenalty(c: number): number {
  return PARTNER_W * (c - 1) * (c - 1);
}

function opponentPenalty(c: number): number {
  return OPPONENT_W * c * c;
}

/** Cost of every pair inside `players` — enough to price a swap, since no
 *  other pair's counts can change. */
function localPairCost(s: State, players: number[]): number {
  const { n, partner, opponent } = s;
  let total = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const idx = players[i] * n + players[j];
      total += partnerPenalty(partner[idx]) + opponentPenalty(opponent[idx]);
    }
  }
  return total;
}

function applyQuad(s: State, q: Quad, sign: number): void {
  const { n, partner, opponent } = s;
  const [a, b, c, d] = q;
  partner[a * n + b] += sign;
  partner[b * n + a] += sign;
  partner[c * n + d] += sign;
  partner[d * n + c] += sign;
  for (const x of [a, b]) {
    for (const y of [c, d]) {
      opponent[x * n + y] += sign;
      opponent[y * n + x] += sign;
    }
  }
}

/**
 * Polish a finished schedule by swapping two players' seats.
 *
 * A swap moves each player into the other's match, so every player's game
 * count is untouched; the only extra requirement is that a player never lands
 * in a round they are already playing in. That keeps the court/round
 * invariants intact while partnerships get redistributed.
 */
function globalRepair(
  s: State,
  matches: ScheduledMatch[],
  maxPasses = 20,
): void {
  const quads: Quad[] = matches.map((m) => [m.team1[0], m.team1[1], m.team2[0], m.team2[1]]);
  const rounds = matches.map((m) => m.round);
  const roundCount = rounds.length ? Math.max(...rounds) : 0;
  const occupancy: Array<Set<number>> = Array.from({ length: roundCount + 1 }, () => new Set<number>());
  quads.forEach((q, i) => q.forEach((p) => occupancy[rounds[i]].add(p)));

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    for (let i = 0; i < quads.length; i++) {
      for (let pi = 0; pi < 4; pi++) {
        for (let j = i; j < quads.length; j++) {
          for (let pj = j === i ? pi + 1 : 0; pj < 4; pj++) {
            const sameMatch = i === j;
            // Swapping the two seats of one team changes nothing.
            if (sameMatch && Math.floor(pi / 2) === Math.floor(pj / 2)) continue;

            const p = quads[i][pi];
            const q = quads[j][pj];
            if (p === q) continue;

            const ri = rounds[i];
            const rj = rounds[j];
            if (ri !== rj && (occupancy[ri].has(q) || occupancy[rj].has(p))) continue;

            const affected = [...new Set(sameMatch ? quads[i] : [...quads[i], ...quads[j]])];
            const before = localPairCost(s, affected);

            applyQuad(s, quads[i], -1);
            if (!sameMatch) applyQuad(s, quads[j], -1);
            quads[i][pi] = q;
            quads[j][pj] = p;
            applyQuad(s, quads[i], +1);
            if (!sameMatch) applyQuad(s, quads[j], +1);

            const after = localPairCost(s, affected);

            if (after < before) {
              improved = true;
              if (ri !== rj) {
                occupancy[ri].delete(p);
                occupancy[ri].add(q);
                occupancy[rj].delete(q);
                occupancy[rj].add(p);
              }
            } else {
              applyQuad(s, quads[i], -1);
              if (!sameMatch) applyQuad(s, quads[j], -1);
              quads[i][pi] = p;
              quads[j][pj] = q;
              applyQuad(s, quads[i], +1);
              if (!sameMatch) applyQuad(s, quads[j], +1);
            }
          }
        }
      }
    }

    if (!improved) break;
  }

  matches.forEach((m, i) => {
    m.team1 = [quads[i][0], quads[i][1]];
    m.team2 = [quads[i][2], quads[i][3]];
  });
}

function measure(s: State): ScheduleQuality {
  const { n, partner, games } = s;
  let missed = 0;
  let repeated = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = partner[i * n + j];
      if (c === 0) missed++;
      else if (c > 1) repeated += c - 1;
    }
  }
  return {
    missedPartnerships: missed,
    repeatedPartnerships: repeated,
    minGames: Math.min(...games),
    maxGames: Math.max(...games),
  };
}

function penalty(q: ScheduleQuality): number {
  return (
    10_000 * q.missedPartnerships +
    10_000 * q.repeatedPartnerships +
    500 * (q.maxGames - q.minGames)
  );
}

/** Matches needed for every pair to partner at least once. */
export function totalMatchesFor(playerCount: number): number {
  return Math.ceil((playerCount * (playerCount - 1)) / 4);
}

export function generateAmericano(
  playerCount: number,
  courts: number,
  opts: { seed?: number; attempts?: number } = {},
): Schedule {
  const n = playerCount;
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`Число игроков должно быть от ${MIN_PLAYERS} до ${MAX_PLAYERS}`);
  }
  if (!Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS) {
    throw new Error(`Число кортов должно быть от 1 до ${MAX_COURTS}`);
  }

  const matchesPerRound = Math.min(courts, Math.floor(n / 4));
  const totalMatches = totalMatchesFor(n);

  // Bigger fields make each attempt more expensive — trade breadth for size.
  const attempts = opts.attempts ?? (n <= 12 ? 60 : n <= 20 ? 30 : 12);
  const restarts = n <= 12 ? 6 : 4;
  const baseSeed = opts.seed ?? ((Math.random() * 2 ** 32) >>> 0);

  // `repeats > 0` is unavoidable when 2·totalMatches exceeds the number of
  // pairs, so treat that surplus as free rather than chasing an impossible
  // zero. Anything above the floor is worth spending more time on.
  const surplus = 2 * totalMatches - (n * (n - 1)) / 2;
  // A player count that does not divide the seats evenly forces a spread of 1.
  const spreadFloor = (4 * totalMatches) % n === 0 ? 0 : 1;
  const floorPenalty = 10_000 * surplus + 500 * spreadFloor;
  const deadline = Date.now() + (opts.attempts ? 0 : 2500);

  let best: { matches: ScheduledMatch[]; state: State } | null = null;
  let bestPenalty = Infinity;
  let sweep = 0;

  do {
    // Phase 1 — many cheap randomised builds, keep the most promising one.
    let round: { matches: ScheduledMatch[]; state: State } | null = null;
    let roundPenalty = Infinity;
    const offset = sweep++ * attempts;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const rng = mulberry32((baseSeed + (offset + attempt) * 0x9e3779b9) >>> 0);
      const { matches, state } = buildSchedule(n, matchesPerRound, totalMatches, rng, restarts);
      const p = penalty(measure(state));
      if (p < roundPenalty) {
        roundPenalty = p;
        round = { matches, state };
      }
      if (p <= floorPenalty) break;
    }

    // Phase 2 — polish the winner with whole-schedule swaps. This is where the
    // last few stubborn partnerships usually get resolved.
    if (roundPenalty > floorPenalty) {
      globalRepair(round!.state, round!.matches);
      roundPenalty = penalty(measure(round!.state));
    }

    if (roundPenalty < bestPenalty) {
      bestPenalty = roundPenalty;
      best = round;
    }
  } while (bestPenalty > floorPenalty && Date.now() < deadline);

  const { matches, state } = best!;
  const quality = measure(state);
  return {
    matches,
    rounds: matches.length ? matches[matches.length - 1].round : 0,
    matchesPerRound,
    quality,
  };
}
