import { extendAmericano, generateAmericano, totalMatchesFor, MAX_PLAYERS, type PlayedMatch } from './americano.ts';
import { activeCourts, validateCourts, type CourtConfig, type Team } from './courts.ts';
import { mulberry32, shuffle } from './rng.ts';

export interface CourtMatch {
  round: number;
  court: number;
  team1: Team<number>;
  team2: Team<number>;
}

export type CourtHistory = Pick<CourtMatch, 'round' | 'team1' | 'team2'>;

function assertPlayers(n: number, config: CourtConfig): void {
  validateCourts(config);
  const min = config.doubles > 0 ? 4 : 2;
  if (!Number.isInteger(n) || n < min || n > MAX_PLAYERS) {
    throw new Error(`Число игроков должно быть от ${min} до ${MAX_PLAYERS}`);
  }
}

/** Same calculation in the form, tournament list and schedule builder. */
export function americanoSize(n: number, config: CourtConfig): { matches: number; rounds: number } {
  const active = activeCourts(n, config);
  if (config.doubles === 0) {
    return {
      matches: n * (n - 1) / 2,
      rounds: (n % 2 === 0 ? n - 1 : n) * Math.ceil(Math.floor(n / 2) / Math.max(1, active.singles)),
    };
  }
  const doubles = totalMatchesFor(n);
  const perRound = Math.max(1, active.doubles);
  const rounds = Math.ceil(doubles / perRound);
  const lastDoubles = doubles - (rounds - 1) * perRound;
  const lastSingles = Math.min(config.singles, Math.floor((n - lastDoubles * 4) / 2));
  return { matches: doubles + (rounds - 1) * active.singles + lastSingles, rounds };
}

/** Circle method: every unordered pair occurs exactly once, even with a bye. */
function singlesRoundRobin(n: number, courts: number, seed?: number): CourtMatch[] {
  const ring = shuffle(Array.from({ length: n }, (_, i) => i), mulberry32(seed ?? 1));
  if (n % 2) ring.push(-1);
  const matches: CourtMatch[] = [];
  let round = 0;
  for (let cycle = 0; cycle < ring.length - 1; cycle++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (a !== -1 && b !== -1) pairs.push([a, b]);
    }
    for (let i = 0; i < pairs.length; i += courts) {
      round++;
      pairs.slice(i, i + courts).forEach(([a, b], court) => {
        matches.push({ round, court: court + 1, team1: [a], team2: [b] });
      });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  return matches;
}

/** Fill unused player slots; only singles history counts towards singles rematches. */
function addSingles(
  n: number, config: CourtConfig, doubles: CourtMatch[], rounds: number,
  history: CourtHistory[] = [], seed = 1,
): CourtMatch[] {
  const rng = mulberry32(seed);
  const games = Array(n).fill(0) as number[];
  const singleGames = Array(n).fill(0) as number[];
  const met = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  function record(m: CourtHistory) {
    for (const p of [...m.team1, ...m.team2]) games[p]++;
    if (m.team1.length === 1) {
      const a = m.team1[0], b = m.team2[0];
      singleGames[a]++; singleGames[b]++;
      met[a][b]++; met[b][a]++;
    }
  }
  history.forEach(record);
  const result: CourtMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const current = doubles.filter((m) => m.round === round);
    const busy = new Set(current.flatMap((m) => [...m.team1, ...m.team2]));
    result.push(...current);
    current.forEach(record);
    const pool = shuffle(Array.from({ length: n }, (_, i) => i).filter((p) => !busy.has(p)), rng);
    pool.sort((a, b) => games[a] - games[b] || singleGames[a] - singleGames[b]);
    const selected = pool.slice(0, config.singles * 2);
    if (selected.length % 2) selected.pop();
    let court = config.doubles;
    while (selected.length >= 2) {
      const a = selected.shift()!;
      selected.sort((b, c) => met[a][b] - met[a][c]);
      const b = selected.shift()!;
      const m: CourtMatch = { round, court: ++court, team1: [a], team2: [b] };
      result.push(m); record(m);
    }
  }

  // The doubles schedule is fixed. Improve singles by trading a place with a
  // resting player in the same round, minimising total games, singles games,
  // then repeated opponents. Every accepted move strictly reduces this cost.
  const occupied = new Map<number, Set<number>>();
  for (const m of result) {
    const set = occupied.get(m.round) ?? new Set<number>();
    for (const p of [...m.team1, ...m.team2]) set.add(p);
    occupied.set(m.round, set);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (const m of result) {
      if (m.team1.length !== 1) continue;
      const busy = occupied.get(m.round)!;
      for (const side of ['team1', 'team2'] as const) {
        const a = m[side][0], opponent = m[side === 'team1' ? 'team2' : 'team1'][0];
        let best = a, cost = 0;
        for (let b = 0; b < n; b++) {
          if (busy.has(b)) continue;
          const delta = 100000 * (2 * (games[b] - games[a]) + 2) +
            1000 * (2 * (singleGames[b] - singleGames[a]) + 2) +
            2 * (met[b][opponent] - met[a][opponent]) + 2;
          if (delta < cost) { best = b; cost = delta; }
        }
        if (best === a) continue;
        busy.delete(a); busy.add(best);
        games[a]--; games[best]++;
        singleGames[a]--; singleGames[best]++;
        met[a][opponent]--; met[opponent][a]--;
        met[best][opponent]++; met[opponent][best]++;
        m[side] = [best];
        improved = true;
      }
    }
  }
  return result;
}

export function generateCourtAmericano(n: number, config: CourtConfig, seed?: number): CourtMatch[] {
  assertPlayers(n, config);
  if (config.doubles === 0) return singlesRoundRobin(n, config.singles, seed);
  const active = activeCourts(n, config);
  const schedule = generateAmericano(n, active.doubles, { seed });
  return config.singles === 0 ? schedule.matches :
    addSingles(n, config, schedule.matches, schedule.rounds, [], seed);
}

export function extendCourtAmericano(
  n: number, config: CourtConfig, rounds: number, history: CourtHistory[], seed?: number,
): CourtMatch[] {
  assertPlayers(n, config);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 30) throw new Error('Добавить можно от 1 до 30 раундов');
  const doublesHistory: PlayedMatch[] = history.flatMap((m) =>
    m.team1.length === 2 && m.team2.length === 2 ? [{ ...m, team1: m.team1, team2: m.team2 }] : []);
  const doubles = config.doubles === 0 ? [] :
    extendAmericano(n, activeCourts(n, config).doubles, rounds, doublesHistory, { seed });
  return config.singles === 0 ? doubles : addSingles(n, config, doubles, rounds, history, seed);
}
