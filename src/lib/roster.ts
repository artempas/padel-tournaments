import { ApiError, parseUuid } from './api';
import { normalizeKey } from './normalize';
import { prisma } from './prisma';
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
  const rows = await prisma.$queryRaw<CareerRow[]>`
    SELECT person_id AS id, name, points_for, points_against, diff,
           matches, wins, tournaments, last_played_at
      FROM person_career
     WHERE owner_id = ${ownerId}::uuid
       AND archived_at IS NULL
     ORDER BY points_for DESC, lower(name)
  `;

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
