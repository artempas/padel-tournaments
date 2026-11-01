/**
 * Mexicano round builder.
 *
 * Court types are fixed at creation; a match is 1 vs 1 or 2 vs 2.
 * The opening round uses club ratings, later rounds use standings. Rest rotates
 * by bench history. Singles appearances rotate too; within the selected pool,
 * neighbours in rank meet. Remaining players form ranked foursomes with the
 * 1st + 4th against 2nd + 3rd pairing.
 *
 * Unlike Americano there is nothing to search for: a round is a deterministic
 * function of the table, so the schedule can only be built one round at a time,
 * as results come in.
 */

// Расширения указаны намеренно — см. комментарий к тому же импорту в americano.ts.
import { MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS } from './americano.ts';
import { mulberry32, shuffle } from './rng.ts';
import { activeCourts, validateCourts, type CourtConfig, type Team } from './courts.ts';

export { MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS };

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 30;
export const DEFAULT_ROUNDS = 8;

export interface RoundMatch {
  /** 1-based */
  court: number;
  /** indices into whatever list the caller passed in */
  team1: Team<number>;
  team2: Team<number>;
}

function configOf(courts: number | CourtConfig): CourtConfig {
  return typeof courts === 'number' ? { doubles: courts, singles: 0 } : courts;
}

/** Courts that can actually be filled — the rest would stand empty. */
export function matchesPerRound(playerCount: number, courts: number | CourtConfig): number {
  const active = activeCourts(playerCount, configOf(courts));
  return active.doubles + active.singles;
}

export function validateRounds(rounds: number): number {
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(`Число раундов должно быть от ${MIN_ROUNDS} до ${MAX_ROUNDS}`);
  }
  return rounds;
}

function assertField(playerCount: number, courts: number | CourtConfig): void {
  const config = configOf(courts);
  validateCourts(config);
  const min = config.doubles > 0 ? MIN_PLAYERS : 2;
  if (!Number.isInteger(playerCount) || playerCount < min || playerCount > MAX_PLAYERS) {
    throw new Error(`Число игроков должно быть от ${min} до ${MAX_PLAYERS}`);
  }
}

/**
 * Split an ordered list of players into courts. `ordered[0]` is the strongest
 * player on court 1; everyone past the last full foursome is resting.
 */
function seatByRank(ordered: number[], config: CourtConfig, active: CourtConfig, singlesPlayed: number[] = []): RoundMatch[] {
  const matches: RoundMatch[] = [];
  // Rotate singles appearances. Among equally eligible players, take neighbours
  // in the standings, then pair that pool in rank order.
  const eligible = [...ordered].sort((a, b) => (singlesPlayed[a] ?? 0) - (singlesPlayed[b] ?? 0));
  const singleSet = new Set(eligible.slice(0, active.singles * 2));
  const doubles = ordered.filter((p) => !singleSet.has(p));
  const singles = ordered.filter((p) => singleSet.has(p));
  for (let i = 0; i < active.doubles; i++) {
    const [a, b, c, d] = doubles.slice(i * 4, i * 4 + 4);
    matches.push({ court: i + 1, team1: [a, d], team2: [b, c] });
  }
  for (let i = 0; i < active.singles; i++) {
    matches.push({ court: config.doubles + i + 1, team1: [singles[i * 2]], team2: [singles[i * 2 + 1]] });
  }
  return matches;
}

/**
 * The opening round, seeded by rating: `ratings[i]` belongs to seat `i` — the
 * order players were entered in — and the strongest four open court 1.
 *
 * Equal ratings are separated by the draw, not by seat order: in a new club
 * everyone starts level, and entering players in strength order must not stack
 * the first court.
 */
export function firstRound(ratings: number[], courts: number | CourtConfig, seed?: number): RoundMatch[] {
  const playerCount = ratings.length;
  assertField(playerCount, courts);

  const rng = mulberry32(seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const seats = shuffle(
    Array.from({ length: playerCount }, (_, i) => i),
    rng,
  );

  // Сортировка стабильная, поэтому жребий выше решает ровно то, чего не решил
  // рейтинг, — порядок внутри равных.
  seats.sort((a, b) => ratings[b] - ratings[a]);

  const config = configOf(courts);
  const active = activeCourts(playerCount, config);
  return seatByRank(seats.slice(0, active.doubles * 4 + active.singles * 2), config, active);
}

/**
 * The next round, given how many rounds each player has spent on the bench **in
 * standings order** — `rested[0]` belongs to the current leader.
 *
 * Returned indices refer to that same order, so the caller maps position in
 * the table back to a player.
 */
export function nextRound(rested: number[], courts: number | CourtConfig, singlesPlayed: number[] = []): RoundMatch[] {
  const playerCount = rested.length;
  assertField(playerCount, courts);

  const config = configOf(courts);
  const active = activeCourts(playerCount, config);
  const seats = active.doubles * 4 + active.singles * 2;

  // Who sits out: the least-rested first, and among equals the lower half of
  // the table — a leader losing court time would distort the very ranking the
  // next round is built from.
  const ranks = Array.from({ length: playerCount }, (_, rank) => rank);
  const resting = new Set(
    ranks
      .slice()
      .sort((a, b) => rested[a] - rested[b] || b - a)
      .slice(0, playerCount - seats),
  );

  return seatByRank(
    ranks.filter((rank) => !resting.has(rank)),
    config,
    active,
    singlesPlayed,
  );
}
