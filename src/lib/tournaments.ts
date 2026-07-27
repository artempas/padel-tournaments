import { randomUUID } from 'node:crypto';
import { ApiError, parseUuid } from './api';
import { generateAmericano, MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS } from './americano';
import { normalizeKey } from './normalize';
import { prisma } from './prisma';
import { upsertPeople } from './roster';
import type {
  Match,
  Player,
  TournamentDetail,
  TournamentFormat,
  TournamentSummary,
} from './types';
import type { Prisma } from '@/generated/prisma/client';

export interface CreateTournamentInput {
  name?: string;
  players?: unknown;
  courts?: unknown;
  pointsPerMatch?: unknown;
}

interface ValidatedInput {
  name: string;
  players: string[];
  courts: number;
  pointsPerMatch: number;
}

export function validateCreateInput(input: CreateTournamentInput): ValidatedInput {
  const name = (input.name ?? '').trim();
  if (!name || name.length > 80) {
    throw new ApiError('Название турнира обязательно (до 80 символов)');
  }

  if (!Array.isArray(input.players)) throw new ApiError('Список игроков обязателен');
  const players = input.players.map((p) => String(p ?? '').trim()).filter(Boolean);

  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new ApiError(`Нужно от ${MIN_PLAYERS} до ${MAX_PLAYERS} игроков`);
  }
  if (players.some((p) => p.length > 40)) {
    throw new ApiError('Имя игрока не длиннее 40 символов');
  }

  // Та же нормализация, что уходит в people.name_key, — иначе два имени,
  // которые база считает одним человеком, попали бы на два места в турнире.
  const seen = new Set(players.map(normalizeKey));
  if (seen.size !== players.length) throw new ApiError('Имена игроков должны быть уникальными');

  const courts = Number(input.courts);
  if (!Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS) {
    throw new ApiError(`Число кортов должно быть от 1 до ${MAX_COURTS}`);
  }

  const pointsPerMatch = input.pointsPerMatch === undefined ? 16 : Number(input.pointsPerMatch);
  if (!Number.isInteger(pointsPerMatch) || pointsPerMatch < 1 || pointsPerMatch > 200) {
    throw new ApiError('Очков за матч должно быть от 1 до 200');
  }

  return { name, players, courts, pointsPerMatch };
}

/**
 * Статус турнира в базе не хранится — он выводится из двух меток времени.
 * Здесь то же правило, что во вью tournament_overview: метка «досрочно» видна,
 * только пока действительно осталось недоигранное.
 */
function lifecycle(completedAt: Date | null, closedAt: Date | null) {
  const finished = completedAt !== null || closedAt !== null;
  const stamps = [completedAt, closedAt].filter((d): d is Date => d !== null);
  return {
    status: (finished ? 'finished' : 'running') as 'running' | 'finished',
    closedEarly: closedAt !== null && completedAt === null,
    finishedAt: stamps.length
      ? new Date(Math.min(...stamps.map((d) => d.getTime()))).toISOString()
      : null,
  };
}

export async function createTournament(
  ownerId: string,
  input: CreateTournamentInput,
): Promise<string> {
  const { name, players, courts, pointsPerMatch } = validateCreateInput(input);
  const schedule = generateAmericano(players.length, courts);

  return prisma.$transaction(async (tx) => {
    // Everyone entered here joins the organiser's permanent roster, which is
    // what makes cross-tournament totals possible.
    const people = await upsertPeople(tx, ownerId, players);

    // Участники заводятся вместе с турниром: seat N совпадает с индексом N,
    // по которому генератор расставил игроков в расписании.
    const tournament = await tx.tournament.create({
      data: {
        ownerId,
        name,
        courts,
        pointsPerMatch,
        format: 'americano',
        players: {
          create: players.map((playerName, seat) => ({
            seat,
            personId: people.get(normalizeKey(playerName))!,
          })),
        },
      },
      select: { id: true, players: { select: { id: true, seat: true } } },
    });

    const bySeat = new Map(tournament.players.map((p) => [p.seat, p.id]));
    const seatId = (index: number): string => bySeat.get(index)!;

    // id матчей генерируются здесь, чтобы участников можно было вставить одним
    // createMany, не дожидаясь RETURNING. Триггер «ровно четверо» отложен до
    // COMMIT, поэтому промежуточное состояние его не смущает.
    const matches = schedule.matches.map((m) => ({
      id: randomUUID(),
      tournamentId: tournament.id,
      roundNo: m.round,
      courtNo: m.court,
      pointsSum: pointsPerMatch,
    }));

    await tx.match.createMany({ data: matches });

    await tx.matchParticipant.createMany({
      data: schedule.matches.flatMap((m, i) => {
        const shared = {
          matchId: matches[i].id,
          tournamentId: tournament.id,
          roundNo: m.round,
        };
        return [
          { ...shared, tournamentPlayerId: seatId(m.team1[0]), side: 'a' as const, slot: 1 },
          { ...shared, tournamentPlayerId: seatId(m.team1[1]), side: 'a' as const, slot: 2 },
          { ...shared, tournamentPlayerId: seatId(m.team2[0]), side: 'b' as const, slot: 1 },
          { ...shared, tournamentPlayerId: seatId(m.team2[1]), side: 'b' as const, slot: 2 },
        ];
      }),
    });

    return tournament.id;
  });
}

interface OverviewRow {
  id: string;
  name: string;
  courts: number;
  format: TournamentFormat;
  points_per_match: number;
  completed_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  player_count: bigint;
  match_count: bigint;
  played_count: bigint;
}

/**
 * Список турниров берётся из вью: счётчик сыгранных матчей — это count с
 * условием, а такой агрегат по связи Prisma выразить не умеет.
 */
export async function listTournaments(ownerId: string): Promise<TournamentSummary[]> {
  const rows = await prisma.$queryRaw<OverviewRow[]>`
    SELECT id, name, courts, format, points_per_match,
           completed_at, closed_at, created_at,
           player_count, match_count, played_count
      FROM tournament_overview
     WHERE owner_id = ${ownerId}::uuid
     ORDER BY created_at DESC
  `;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    courts: r.courts,
    format: r.format,
    pointsPerMatch: r.points_per_match,
    createdAt: r.created_at.toISOString(),
    ...lifecycle(r.completed_at, r.closed_at),
    playerCount: Number(r.player_count),
    matchCount: Number(r.match_count),
    playedCount: Number(r.played_count),
  }));
}

export async function loadTournament(id: string, ownerId: string): Promise<TournamentDetail> {
  const tournamentId = parseUuid(id, 'Турнир не найден');

  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, ownerId },
    select: {
      id: true,
      name: true,
      courts: true,
      format: true,
      pointsPerMatch: true,
      completedAt: true,
      closedAt: true,
      createdAt: true,
      players: {
        select: { id: true, seat: true, person: { select: { name: true } } },
        orderBy: { seat: 'asc' },
      },
      matches: {
        select: {
          id: true,
          roundNo: true,
          courtNo: true,
          scoreA: true,
          scoreB: true,
          participants: { select: { tournamentPlayerId: true, side: true, slot: true } },
        },
        orderBy: [{ roundNo: 'asc' }, { courtNo: 'asc' }],
      },
    },
  });

  if (!t) throw new ApiError('Турнир не найден', 404);

  const players: Player[] = t.players.map((p) => ({
    id: p.id,
    name: p.person.name,
    seat: p.seat,
  }));

  const matches: Match[] = t.matches.map((m) => {
    // Участники приходят четырьмя строками; наружу отдаём прежнюю форму, чтобы
    // клиенту не пришлось знать про раскладку по side/slot.
    const seat = (side: 'a' | 'b', slot: number): string =>
      m.participants.find((p) => p.side === side && p.slot === slot)!.tournamentPlayerId;

    return {
      id: m.id,
      round: m.roundNo,
      court: m.courtNo,
      team1: [seat('a', 1), seat('a', 2)],
      team2: [seat('b', 1), seat('b', 2)],
      score1: m.scoreA,
      score2: m.scoreB,
    };
  });

  return {
    id: t.id,
    name: t.name,
    courts: t.courts,
    format: t.format,
    pointsPerMatch: t.pointsPerMatch,
    createdAt: t.createdAt.toISOString(),
    ...lifecycle(t.completedAt, t.closedAt),
    players,
    matches,
  };
}

export async function deleteTournament(id: string, ownerId: string): Promise<void> {
  const tournamentId = parseUuid(id, 'Турнир не найден');
  const { count } = await prisma.tournament.deleteMany({ where: { id: tournamentId, ownerId } });
  if (count === 0) throw new ApiError('Турнир не найден', 404);
}

/**
 * Record (or clear) a match result. Scores must add up to the tournament's
 * points-per-match, which is what makes "16 очков на матч" a hard rule rather
 * than a convention. База проверяет это же ограничением matches_score_sum —
 * здесь проверка нужна лишь затем, чтобы вернуть внятный текст вместо 500.
 */
export async function setMatchScore(
  tournamentId: string,
  matchId: string,
  ownerId: string,
  score1: number | null,
  score2: number | null,
): Promise<TournamentDetail> {
  const tid = parseUuid(tournamentId, 'Матч не найден');
  const mid = parseUuid(matchId, 'Матч не найден');

  const t = await prisma.tournament.findFirst({
    where: { id: tid, ownerId },
    select: { pointsPerMatch: true },
  });
  if (!t) throw new ApiError('Турнир не найден', 404);

  const clearing = score1 === null && score2 === null;
  if (!clearing) {
    if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1! < 0 || score2! < 0) {
      throw new ApiError('Счёт должен быть неотрицательным целым числом');
    }
    if (score1! + score2! !== t.pointsPerMatch) {
      throw new ApiError(`Сумма очков в матче должна быть равна ${t.pointsPerMatch}`);
    }
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.match.updateMany({
      where: { id: mid, tournamentId: tid },
      data: { scoreA: score1, scoreB: score2, playedAt: clearing ? null : new Date() },
    });
    if (updated.count === 0) throw new ApiError('Матч не найден', 404);

    await refreshCompletion(tx, tid);
  });

  return loadTournament(tid, ownerId);
}

/**
 * A tournament is complete when every match has a score. `completed_at` keeps
 * the moment it first became so: the `completedAt: null` guard means correcting
 * a score afterwards does not move the timestamp.
 */
async function refreshCompletion(tx: Prisma.TransactionClient, tournamentId: string): Promise<void> {
  const unplayed = await tx.match.count({ where: { tournamentId, scoreA: null } });

  if (unplayed === 0) {
    await tx.tournament.updateMany({
      where: { id: tournamentId, completedAt: null },
      data: { completedAt: new Date() },
    });
  } else {
    await tx.tournament.updateMany({
      where: { id: tournamentId, completedAt: { not: null } },
      data: { completedAt: null },
    });
  }
}

/**
 * Stop a tournament before every match is played, or resume a stopped one.
 * Unplayed matches keep their empty score and simply stay out of the table.
 */
export async function setTournamentClosed(
  tournamentId: string,
  ownerId: string,
  closed: boolean,
): Promise<TournamentDetail> {
  const tid = parseUuid(tournamentId, 'Турнир не найден');

  const owned = await prisma.tournament.findFirst({
    where: { id: tid, ownerId },
    select: { closedAt: true },
  });
  if (!owned) throw new ApiError('Турнир не найден', 404);

  // Повторное закрытие не сдвигает метку — по той же причине, что и completed_at.
  if (closed !== (owned.closedAt !== null)) {
    await prisma.tournament.updateMany({
      where: { id: tid, ownerId },
      data: { closedAt: closed ? new Date() : null },
    });
  }

  return loadTournament(tid, ownerId);
}
