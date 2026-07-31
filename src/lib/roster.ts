import { ApiError, parseUuid } from './api';
import { normalizeKey } from './normalize';
import { prisma } from './prisma';
import { computeRatings, START_RATING, type RatedMatch, type Rating } from './rating';
import type { Prisma } from '@/generated/prisma/client';

export interface RosterPlayer {
  id: string;
  name: string;
}

export interface RosterStat extends RosterPlayer {
  /** Total points this person's team scored across every tournament. */
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  matches: number;
  wins: number;
  tournaments: number;
  lastPlayedAt: string | null;
  /** Клубный рейтинг, округлённый: см. lib/rating.ts. */
  rating: number;
}

/**
 * Adds any unseen names to the organiser's roster and returns every id keyed
 * by normalised name. Existing entries keep their id but adopt the latest
 * spelling, so fixing a typo updates the person rather than duplicating them.
 * A name that was archived comes back — «удалить» здесь значит «спрятать».
 *
 * Upsert на каждое имя вместо одного INSERT ... ON CONFLICT: игроков максимум
 * 32, и это происходит однажды при создании турнира, так что типобезопасность
 * стоит нескольких запросов внутри уже открытой транзакции.
 */
export async function upsertPeople(
  tx: Prisma.TransactionClient,
  ownerId: string,
  names: string[],
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();

  for (const name of names) {
    const nameKey = normalizeKey(name);
    const person = await tx.person.upsert({
      where: { ownerId_nameKey: { ownerId, nameKey } },
      create: { ownerId, name, nameKey },
      update: { name, archivedAt: null },
      select: { id: true },
    });
    byKey.set(nameKey, person.id);
  }

  return byKey;
}

export async function listRoster(ownerId: string): Promise<RosterPlayer[]> {
  return prisma.person.findMany({
    where: { ownerId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { nameKey: 'asc' },
  });
}

interface HistoryRow {
  match_id: string;
  person_id: string;
  side: 'a' | 'b';
  score_a: number;
  score_b: number;
}

/** Границы истории: всё, что сыграно строго раньше этого турнира. */
export interface HistoryCutoff {
  id: string;
  createdAt: Date;
}

/**
 * Сыгранные матчи ростера в том порядке, в каком в них играли.
 *
 * Порядок здесь — не украшение: Elo путезависим, и от него зависит результат.
 * Задаётся он созданием турнира и местом матча в сетке, а не `played_at`: та
 * метка сдвигается при перевнесении счёта, и тогда исправление опечатки в
 * давнем матче переписывало бы историю рейтинга целиком.
 *
 * `id` турнира в ключе сортировки — на случай двух турниров, созданных в одну
 * миллисекунду: порядок должен быть определён всегда, иначе один и тот же
 * ростер давал бы разные числа от запроса к запросу.
 */
async function ratedHistory(ownerId: string, before?: HistoryCutoff): Promise<RatedMatch[]> {
  const cutoffAt = before?.createdAt ?? null;
  const cutoffId = before?.id ?? null;

  const rows = await prisma.$queryRaw<HistoryRow[]>`
    SELECT mp.match_id, tp.person_id, mp.side, m.score_a, m.score_b
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN match_participants mp ON mp.match_id = m.id
      JOIN tournament_players tp ON tp.id = mp.tournament_player_id
     WHERE t.owner_id = ${ownerId}::uuid
       AND m.score_a IS NOT NULL
       AND (${cutoffAt}::timestamptz IS NULL
            OR (t.created_at, t.id) < (${cutoffAt}::timestamptz, ${cutoffId}::uuid))
     ORDER BY t.created_at, t.id, m.round_no, m.court_no, mp.side, mp.slot
  `;

  return toMatches(rows);
}

/**
 * Четыре строки участников обратно в один матч. Порядок матчей — тот, в котором
 * их встретил запрос: Map помнит порядок вставки, и сортировка доезжает сюда
 * нетронутой.
 */
function toMatches(rows: HistoryRow[]): RatedMatch[] {
  interface Open {
    a: string[];
    b: string[];
    scoreA: number;
    scoreB: number;
  }
  const byMatch = new Map<string, Open>();

  for (const row of rows) {
    let open = byMatch.get(row.match_id);
    if (!open) {
      byMatch.set(row.match_id, (open = { a: [], b: [], scoreA: row.score_a, scoreB: row.score_b }));
    }
    (row.side === 'a' ? open.a : open.b).push(row.person_id);
  }

  return (
    [...byMatch.values()]
      // «В матче ровно четверо» держит отложенный триггер в базе, так что
      // неполной четвёрке взяться неоткуда; проверка стоит ради типа пары.
      .filter((m) => m.a.length === 2 && m.b.length === 2)
      .map((m): RatedMatch => ({
        teamA: [m.a[0], m.a[1]],
        teamB: [m.b[0], m.b[1]],
        scoreA: m.scoreA,
        scoreB: m.scoreB,
      }))
  );
}

/**
 * Рейтинг каждого человека в ростере, посчитанный по всей его истории.
 * `before` обрезает историю: так берётся состояние на начало турнира.
 */
export async function ratingsForOwner(
  ownerId: string,
  before?: HistoryCutoff,
): Promise<Map<string, Rating>> {
  return computeRatings(await ratedHistory(ownerId, before));
}

interface CareerRow {
  id: string;
  name: string;
  points_for: bigint;
  points_against: bigint;
  diff: bigint;
  matches: bigint;
  wins: bigint;
  tournaments: bigint;
  last_played_at: Date | null;
}

/**
 * Career totals per person, из вью person_career.
 *
 * Это единственное место, где нужен сырой SQL: очки участника зависят от того,
 * на какой стороне матча он стоял, а такой CASE в языке запросов Prisma не
 * выражается. Зато обход идёт по индексам — в v1 здесь был полный скан matches.
 */
export async function rosterStats(ownerId: string): Promise<RosterStat[]> {
  // Суммы берёт вью, рейтинг — проход по истории: агрегат его не выражает,
  // потому что каждый матч считается от рейтингов, сложившихся к нему.
  const [rows, ratings] = await Promise.all([
    prisma.$queryRaw<CareerRow[]>`
      SELECT person_id AS id, name, points_for, points_against, diff,
             matches, wins, tournaments, last_played_at
        FROM person_career
       WHERE owner_id = ${ownerId}::uuid
         AND archived_at IS NULL
       ORDER BY points_for DESC, lower(name)
    `,
    ratingsForOwner(ownerId),
  ]);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    pointsFor: Number(r.points_for),
    pointsAgainst: Number(r.points_against),
    diff: Number(r.diff),
    matches: Number(r.matches),
    wins: Number(r.wins),
    tournaments: Number(r.tournaments),
    lastPlayedAt: r.last_played_at?.toISOString() ?? null,
    // Кто ещё не играл, стоит на старте — показать пустоту здесь не лучше.
    rating: Math.round(ratings.get(r.id)?.rating ?? START_RATING),
  }));
}

/**
 * Убирает человека из ростера. Строка остаётся: на неё ссылаются участники
 * сыгранных турниров, и связь помечена ON DELETE RESTRICT именно затем, чтобы
 * историю нельзя было стереть случайно. Пропадает только подсказка при
 * создании нового турнира.
 */
export async function archivePerson(ownerId: string, id: string): Promise<void> {
  const personId = parseUuid(id, 'Игрок не найден');

  const { count } = await prisma.person.updateMany({
    where: { id: personId, ownerId, archivedAt: null },
    data: { archivedAt: new Date() },
  });

  if (count === 0) throw new ApiError('Игрок не найден', 404);
}
