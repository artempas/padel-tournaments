/**
 * Mexicano round builder.
 *
 * Format rules:
 *  - every match is 2 vs 2 and the tournament runs a fixed number of rounds;
 *  - the opening round is seeded by club rating — there is no table yet, but
 *    there is history, and it says more about strength than a draw does;
 *  - every later round is built from the standings as they stand: the four
 *    leaders meet on court 1, the next four on court 2, and so on;
 *  - inside a foursome the pairing is 1st + 4th against 2nd + 3rd, which is
 *    what keeps a match between four differently ranked players close;
 *  - when n is not a multiple of 4 some players rest — the bench goes to
 *    whoever has sat out least, so rest keeps circulating.
 *
 * Unlike Americano there is nothing to search for: a round is a deterministic
 * function of the table, so the schedule can only be built one round at a time,
 * as results come in.
 */

// Расширения указаны намеренно — см. комментарий к тому же импорту в americano.ts.
import { MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS } from './americano.ts';
import { mulberry32, shuffle } from './rng.ts';

export { MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS };

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 30;
export const DEFAULT_ROUNDS = 8;

export interface RoundMatch {
  /** 1-based */
  court: number;
  /** indices into whatever list the caller passed in */
  team1: [number, number];
  team2: [number, number];
}

/** Courts that can actually be filled — the rest would stand empty. */
export function matchesPerRound(playerCount: number, courts: number): number {
  return Math.min(courts, Math.floor(playerCount / 4));
}

export function validateRounds(rounds: number): number {
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(`Число раундов должно быть от ${MIN_ROUNDS} до ${MAX_ROUNDS}`);
  }
  return rounds;
}

function assertField(playerCount: number, courts: number): void {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Число игроков должно быть от ${MIN_PLAYERS} до ${MAX_PLAYERS}`);
  }
  if (!Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS) {
    throw new Error(`Число кортов должно быть от 1 до ${MAX_COURTS}`);
  }
}

/**
 * Split an ordered list of players into courts. `ordered[0]` is the strongest
 * player on court 1; everyone past the last full foursome is resting.
 */
function seatByRank(ordered: number[], courtCount: number): RoundMatch[] {
  const matches: RoundMatch[] = [];
  for (let i = 0; i < courtCount; i++) {
    const [a, b, c, d] = ordered.slice(i * 4, i * 4 + 4);
    matches.push({ court: i + 1, team1: [a, d], team2: [b, c] });
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
export function firstRound(ratings: number[], courts: number, seed?: number): RoundMatch[] {
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

  return seatByRank(seats, matchesPerRound(playerCount, courts));
}

/**
 * The next round, given how many rounds each player has spent on the bench **in
 * standings order** — `rested[0]` belongs to the current leader.
 *
 * Returned indices refer to that same order, so the caller maps position in
 * the table back to a player.
 */
export function nextRound(rested: number[], courts: number): RoundMatch[] {
  const playerCount = rested.length;
  assertField(playerCount, courts);

  const courtCount = matchesPerRound(playerCount, courts);
  const seats = courtCount * 4;

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
    courtCount,
  );
}
