import { ApiError } from './api';
import { query, queryOne, transaction } from './db';
import { generateAmericano, MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS } from './americano';
import type { Match, Player, TournamentDetail, TournamentSummary } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TournamentRow {
  id: string;
  name: string;
  courts: number;
  format: 'americano';
  points_per_match: number;
  status: 'running' | 'finished';
  created_at: Date;
  finished_at: Date | null;
}

interface MatchRow {
  id: string;
  round_no: number;
  court_no: number;
  team1_p1: string;
  team1_p2: string;
  team2_p1: string;
  team2_p2: string;
  score1: number | null;
  score2: number | null;
}

function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    round: row.round_no,
    court: row.court_no,
    team1: [row.team1_p1, row.team1_p2],
    team2: [row.team2_p1, row.team2_p2],
    score1: row.score1,
    score2: row.score2,
  };
}

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

  const seen = new Set(players.map((p) => p.toLocaleLowerCase('ru')));
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

export async function createTournament(
  ownerId: string,
  input: CreateTournamentInput,
): Promise<string> {
  const { name, players, courts, pointsPerMatch } = validateCreateInput(input);
  const schedule = generateAmericano(players.length, courts);

  return transaction(async (client) => {
    const tournament = await client.query<{ id: string }>(
      `INSERT INTO tournaments (owner_id, name, courts, format, points_per_match)
       VALUES ($1, $2, $3, 'americano', $4)
       RETURNING id`,
      [ownerId, name, courts, pointsPerMatch],
    );
    const tournamentId = tournament.rows[0].id;

    // Players are inserted in entry order, so seat N lines up with schedule index N.
    const playerValues = players
      .map((_, i) => `($1, $${i + 2}, ${i})`)
      .join(', ');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO players (tournament_id, name, seat)
       VALUES ${playerValues}
       RETURNING id`,
      [tournamentId, ...players],
    );
    const ids = inserted.rows.map((r) => r.id);

    const params: unknown[] = [tournamentId];
    const rows = schedule.matches.map((m) => {
      const base = params.length;
      params.push(
        m.round,
        m.court,
        ids[m.team1[0]],
        ids[m.team1[1]],
        ids[m.team2[0]],
        ids[m.team2[1]],
      );
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await client.query(
      `INSERT INTO matches (tournament_id, round_no, court_no, team1_p1, team1_p2, team2_p1, team2_p2)
       VALUES ${rows.join(', ')}`,
      params,
    );

    return tournamentId;
  });
}

export async function listTournaments(ownerId: string): Promise<TournamentSummary[]> {
  const rows = await query<
    TournamentRow & { player_count: string; match_count: string; played_count: string }
  >(
    `SELECT t.*,
            (SELECT count(*) FROM players p WHERE p.tournament_id = t.id) AS player_count,
            (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id) AS match_count,
            (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id AND m.score1 IS NOT NULL)
              AS played_count
       FROM tournaments t
      WHERE t.owner_id = $1
      ORDER BY t.created_at DESC`,
    [ownerId],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    courts: r.courts,
    format: r.format,
    pointsPerMatch: r.points_per_match,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    playerCount: Number(r.player_count),
    matchCount: Number(r.match_count),
    playedCount: Number(r.played_count),
  }));
}

export async function loadTournament(
  id: string,
  ownerId: string,
): Promise<TournamentDetail> {
  if (!UUID_RE.test(id)) throw new ApiError('Турнир не найден', 404);

  const t = await queryOne<TournamentRow>(
    'SELECT * FROM tournaments WHERE id = $1 AND owner_id = $2',
    [id, ownerId],
  );
  if (!t) throw new ApiError('Турнир не найден', 404);

  const players = await query<{ id: string; name: string; seat: number }>(
    'SELECT id, name, seat FROM players WHERE tournament_id = $1 ORDER BY seat',
    [id],
  );

  const matches = await query<MatchRow>(
    `SELECT id, round_no, court_no, team1_p1, team1_p2, team2_p1, team2_p2, score1, score2
       FROM matches WHERE tournament_id = $1 ORDER BY round_no, court_no`,
    [id],
  );

  return {
    id: t.id,
    name: t.name,
    courts: t.courts,
    format: t.format,
    pointsPerMatch: t.points_per_match,
    status: t.status,
    createdAt: t.created_at.toISOString(),
    finishedAt: t.finished_at?.toISOString() ?? null,
    players: players as Player[],
    matches: matches.map(toMatch),
  };
}

export async function deleteTournament(id: string, ownerId: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new ApiError('Турнир не найден', 404);
  const rows = await query<{ id: string }>(
    'DELETE FROM tournaments WHERE id = $1 AND owner_id = $2 RETURNING id',
    [id, ownerId],
  );
  if (rows.length === 0) throw new ApiError('Турнир не найден', 404);
}

/**
 * Record (or clear) a match result. Scores must add up to the tournament's
 * points-per-match, which is what makes "16 очков на матч" a hard rule rather
 * than a convention.
 */
export async function setMatchScore(
  tournamentId: string,
  matchId: string,
  ownerId: string,
  score1: number | null,
  score2: number | null,
): Promise<TournamentDetail> {
  if (!UUID_RE.test(tournamentId) || !UUID_RE.test(matchId)) {
    throw new ApiError('Матч не найден', 404);
  }

  const t = await queryOne<{ points_per_match: number }>(
    'SELECT points_per_match FROM tournaments WHERE id = $1 AND owner_id = $2',
    [tournamentId, ownerId],
  );
  if (!t) throw new ApiError('Турнир не найден', 404);

  const clearing = score1 === null && score2 === null;
  if (!clearing) {
    if (
      !Number.isInteger(score1) ||
      !Number.isInteger(score2) ||
      score1! < 0 ||
      score2! < 0
    ) {
      throw new ApiError('Счёт должен быть неотрицательным целым числом');
    }
    if (score1! + score2! !== t.points_per_match) {
      throw new ApiError(`Сумма очков в матче должна быть равна ${t.points_per_match}`);
    }
  }

  await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE matches
          SET score1 = $3, score2 = $4, played_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() END
        WHERE id = $1 AND tournament_id = $2`,
      [matchId, tournamentId, score1, score2],
    );
    if (updated.rowCount === 0) throw new ApiError('Матч не найден', 404);

    // The tournament is finished exactly when no match is left unscored.
    await client.query(
      `UPDATE tournaments t
          SET status = CASE WHEN remaining.count = 0 THEN 'finished' ELSE 'running' END,
              finished_at = CASE WHEN remaining.count = 0 THEN now() ELSE NULL END
         FROM (SELECT count(*) AS count FROM matches
                WHERE tournament_id = $1 AND score1 IS NULL) AS remaining
        WHERE t.id = $1`,
      [tournamentId],
    );
  });

  return loadTournament(tournamentId, ownerId);
}
