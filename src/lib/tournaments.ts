import { randomUUID } from 'node:crypto';
import { ApiError, parseUuid } from './api';
import {
  extendAmericano,
  generateAmericano,
  MAX_COURTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PlayedMatch,
} from './americano';
import {
  DEFAULT_ROUNDS,
  firstRound,
  MAX_ROUNDS,
  MIN_ROUNDS,
  nextRound,
  type RoundMatch,
} from './mexicano';
import { normalizeKey } from './normalize';
import { prisma } from './prisma';
import { START_RATING, type Rating } from './rating';
import { ratingsForOwner, upsertPeople } from './roster';
import { computeStandings } from './standings';
import type {
  Match,
  PlayableFormat,
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
  format?: unknown;
  rounds?: unknown;
}

interface ValidatedInput {
  name: string;
  players: string[];
  courts: number;
  pointsPerMatch: number;
  format: PlayableFormat;
  /** Задана только у mexicano — см. CHECK tournaments_rounds_planned_format. */
  rounds: number | null;
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

  const format = input.format === undefined ? 'americano' : String(input.format);
  if (format !== 'americano' && format !== 'mexicano') {
    throw new ApiError('Формат турнира — «americano» или «mexicano»');
  }

  // Число раундов есть только у mexicano: у американо длину диктует
  // «каждый с каждым», и назначать её со стороны нечему.
  let rounds: number | null = null;
  if (format === 'mexicano') {
    rounds = input.rounds === undefined ? DEFAULT_ROUNDS : Number(input.rounds);
    if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
      throw new ApiError(`Число раундов должно быть от ${MIN_ROUNDS} до ${MAX_ROUNDS}`);
    }
  }

  return { name, players, courts, pointsPerMatch, format, rounds };
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

/** Матч, расставленный по местам участников (seat), но ещё не записанный. */
interface PlannedMatch {
  round: number;
  court: number;
  team1: [number, number];
  team2: [number, number];
}

function planRound(round: number, matches: RoundMatch[]): PlannedMatch[] {
  return matches.map((m) => ({ round, court: m.court, team1: m.team1, team2: m.team2 }));
}

/**
 * Пишет матчи вместе с участниками.
 *
 * id матчей генерируются здесь, чтобы участников можно было вставить одним
 * createMany, не дожидаясь RETURNING. Триггер «ровно четверо» отложен до
 * COMMIT, поэтому промежуточное состояние его не смущает.
 */
async function insertMatches(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  pointsPerMatch: number,
  planned: PlannedMatch[],
  playerIdAt: (seat: number) => string,
): Promise<void> {
  const rows = planned.map((m) => ({
    id: randomUUID(),
    tournamentId,
    roundNo: m.round,
    courtNo: m.court,
    pointsSum: pointsPerMatch,
  }));

  await tx.match.createMany({ data: rows });

  await tx.matchParticipant.createMany({
    data: planned.flatMap((m, i) => {
      const shared = { matchId: rows[i].id, tournamentId, roundNo: m.round };
      return [
        { ...shared, tournamentPlayerId: playerIdAt(m.team1[0]), side: 'a' as const, slot: 1 },
        { ...shared, tournamentPlayerId: playerIdAt(m.team1[1]), side: 'a' as const, slot: 2 },
        { ...shared, tournamentPlayerId: playerIdAt(m.team2[0]), side: 'b' as const, slot: 1 },
        { ...shared, tournamentPlayerId: playerIdAt(m.team2[1]), side: 'b' as const, slot: 2 },
      ];
    }),
  });
}

export async function createTournament(
  ownerId: string,
  input: CreateTournamentInput,
): Promise<string> {
  const { name, players, courts, pointsPerMatch, format, rounds } = validateCreateInput(input);

  // У американо расписание известно целиком заранее. У mexicano заранее
  // известен только первый раунд — остальные достраиваются по таблице, по
  // мере того как приходят результаты (см. extendMexicano).
  const planned =
    format === 'americano'
      ? generateAmericano(players.length, courts).matches
      : planRound(1, firstRound(players.length, courts));

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
        format,
        roundsPlanned: rounds,
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

    await insertMatches(tx, tournament.id, pointsPerMatch, planned, (seat) => bySeat.get(seat)!);

    return tournament.id;
  });
}

interface OverviewRow {
  id: string;
  name: string;
  courts: number;
  format: TournamentFormat;
  rounds_planned: number | null;
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
    SELECT id, name, courts, format, rounds_planned, points_per_match,
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
    roundsPlanned: r.rounds_planned,
    pointsPerMatch: r.points_per_match,
    createdAt: r.created_at.toISOString(),
    ...lifecycle(r.completed_at, r.closed_at),
    playerCount: Number(r.player_count),
    matchCount: Number(r.match_count),
    playedCount: Number(r.played_count),
  }));
}

/** Игроки и матчи в той форме, в которой их ждут клиент и computeStandings. */
const BOARD_SELECT = {
  players: {
    select: { id: true, seat: true, personId: true, person: { select: { name: true } } },
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
} satisfies Prisma.TournamentSelect;

type BoardRows = Prisma.TournamentGetPayload<{ select: typeof BOARD_SELECT }>;

function readBoard(t: BoardRows): { players: Player[]; matches: Match[] } {
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

  return { players, matches };
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
      roundsPlanned: true,
      pointsPerMatch: true,
      completedAt: true,
      closedAt: true,
      createdAt: true,
      ...BOARD_SELECT,
    },
  });

  if (!t) throw new ApiError('Турнир не найден', 404);

  // Рейтинг участников на момент, когда они сюда пришли: всё, что сыграно
  // раньше этого турнира. Ключ меняется с человека на его место в турнире —
  // матчи и таблица знают игроков только так.
  const ratings = await ratingsForOwner(ownerId, { id: t.id, createdAt: t.createdAt });
  const ratingBefore: Record<string, Rating> = {};
  for (const p of t.players) {
    ratingBefore[p.id] = ratings.get(p.personId) ?? { rating: START_RATING, matches: 0 };
  }

  return {
    id: t.id,
    name: t.name,
    courts: t.courts,
    format: t.format,
    roundsPlanned: t.roundsPlanned,
    pointsPerMatch: t.pointsPerMatch,
    createdAt: t.createdAt.toISOString(),
    ...lifecycle(t.completedAt, t.closedAt),
    ...readBoard(t),
    ratingBefore,
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

    // Порядок важен: пока следующий раунд не создан, недоигранных матчей нет,
    // и турнир на секунду выглядел бы завершённым.
    await extendMexicano(tx, tid);
    await refreshCompletion(tx, tid);
  });

  return loadTournament(tid, ownerId);
}

/**
 * Достраивает следующий раунд mexicano, когда текущий доигран целиком.
 *
 * В этом и весь формат: пары следующего раунда — функция от таблицы, поэтому
 * раньше последнего результата их не существует. Отсюда же и то, чего здесь
 * нет: уже созданный раунд не пересобирается, даже если организатор потом
 * поправит счёт задним числом. Люди к этому моменту стоят на кортах, и менять
 * составы под ними — хуже, чем оставить раунд, собранный по прежней таблице.
 *
 * Для американо это no-op: его расписание целиком создано при старте.
 */
async function extendMexicano(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<void> {
  // Сначала дешёвая проверка формата: у американо расписание уже целиком в
  // базе, и тащить его сюда на каждый внесённый счёт незачем.
  const t = await tx.tournament.findUnique({
    where: { id: tournamentId },
    select: { format: true, courts: true, pointsPerMatch: true, roundsPlanned: true },
  });

  if (!t || t.format !== 'mexicano' || t.roundsPlanned === null) return;

  const board = await tx.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: BOARD_SELECT,
  });
  const { players, matches } = readBoard(board);
  const lastRound = matches.reduce((max, m) => Math.max(max, m.round), 0);

  if (lastRound >= t.roundsPlanned) return;
  if (matches.some((m) => m.round === lastRound && m.score1 === null)) return;

  // Тот же порядок, что видит организатор в таблице: пары следующего раунда
  // должны читаться прямо с экрана.
  const standings = computeStandings(players, matches);
  const round = nextRound(
    standings.map((row) => row.played),
    t.courts,
  );

  await insertMatches(
    tx,
    tournamentId,
    t.pointsPerMatch,
    planRound(lastRound + 1, round),
    (place) => standings[place].playerId,
  );
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
 * Продлить турнир: доиграли запланированное, а расходиться рано.
 *
 * Форматы продлеваются по-разному, потому что по-разному знают свою длину.
 * У мексикано она записана числом — его и увеличиваем, а раунд за раундом
 * достроит `extendMexicano`, как и в обычном ходе турнира. У американо длину
 * задаёт «каждый с каждым», менять там нечего: добавочные раунды дописываются
 * сразу, продолжая расписание с учётом всех уже сыгранных пар.
 *
 * `closedAt` не трогается. Длина турнира и решение доигрывать его или нет —
 * разные вещи: продлить на пять раундов и сыграть три из них законно, и
 * заканчивается это обычным досрочным завершением. Ставит и снимает метку
 * только `setTournamentClosed`, по явному действию организатора.
 *
 * `completedAt` — наоборот, снимет `refreshCompletion`: новые матчи ещё без
 * счёта, значит турнир больше не доигран.
 */
export async function extendTournament(
  tournamentId: string,
  ownerId: string,
  extraRounds: number,
): Promise<TournamentDetail> {
  const tid = parseUuid(tournamentId, 'Турнир не найден');

  if (!Number.isInteger(extraRounds) || extraRounds < MIN_ROUNDS || extraRounds > MAX_ROUNDS) {
    throw new ApiError(`Добавить можно от ${MIN_ROUNDS} до ${MAX_ROUNDS} раундов`);
  }

  await prisma.$transaction(async (tx) => {
    const t = await tx.tournament.findFirst({
      where: { id: tid, ownerId },
      select: {
        format: true,
        courts: true,
        pointsPerMatch: true,
        roundsPlanned: true,
        ...BOARD_SELECT,
      },
    });
    if (!t) throw new ApiError('Турнир не найден', 404);

    if (t.format === 'mexicano') {
      // Верхнюю границу держит и CHECK tournaments_rounds_planned_range —
      // здесь она лишь затем, чтобы вместо 500 вернуть внятный текст.
      const planned = (t.roundsPlanned ?? 0) + extraRounds;
      if (planned > MAX_ROUNDS) {
        throw new ApiError(
          `В турнире не может быть больше ${MAX_ROUNDS} раундов — сейчас запланировано ${t.roundsPlanned}`,
        );
      }
      await tx.tournament.update({ where: { id: tid }, data: { roundsPlanned: planned } });
    } else if (t.format === 'americano') {
      const { players, matches } = readBoard(t);
      // Генератор считает игроков номерами; players отсортированы по seat,
      // поэтому место в списке — это и есть индекс, которым он их знает.
      const indexOf = new Map(players.map((p, index) => [p.id, index]));
      const asIndices = (ids: [string, string]): [number, number] => [
        indexOf.get(ids[0])!,
        indexOf.get(ids[1])!,
      ];

      const history: PlayedMatch[] = matches.map((m) => ({
        round: m.round,
        team1: asIndices(m.team1),
        team2: asIndices(m.team2),
      }));
      const lastRound = matches.reduce((max, m) => Math.max(max, m.round), 0);

      const added = extendAmericano(players.length, t.courts, extraRounds, history);
      await insertMatches(
        tx,
        tid,
        t.pointsPerMatch,
        added.map((m) => ({
          round: lastRound + m.round,
          court: m.court,
          team1: m.team1,
          team2: m.team2,
        })),
        (index) => players[index].id,
      );
    } else {
      throw new ApiError('Этот формат турнира продлить нельзя');
    }

    // Тот же порядок, что и при внесении счёта: сначала достроить, потом
    // пересчитать завершённость — иначе турнир на секунду выглядел бы доигранным.
    await extendMexicano(tx, tid);
    await refreshCompletion(tx, tid);
  });

  return loadTournament(tid, ownerId);
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
