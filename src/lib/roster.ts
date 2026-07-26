import type { PoolClient } from 'pg';
import { ApiError } from './api';
import { query } from './db';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adds any unseen names to the organiser's roster and returns every id keyed
 * by lower-cased name. Existing entries keep their id but adopt the latest
 * spelling, so fixing a typo updates the person rather than duplicating them.
 */
export async function upsertRosterPlayers(
  client: PoolClient,
  ownerId: string,
  names: string[],
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();

  const values = names.map((_, i) => `($1, $${i + 2})`).join(', ');
  const { rows } = await client.query<{ id: string; name: string }>(
    `INSERT INTO roster_players (owner_id, name)
     VALUES ${values}
     ON CONFLICT (owner_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name`,
    [ownerId, ...names],
  );

  // RETURNING order is not guaranteed, so map by name rather than by position.
  return new Map(rows.map((r) => [r.name.toLocaleLowerCase('ru'), r.id]));
}

export async function listRoster(ownerId: string): Promise<RosterPlayer[]> {
  return query<RosterPlayer>(
    'SELECT id, name FROM roster_players WHERE owner_id = $1 ORDER BY lower(name)',
    [ownerId],
  );
}

/**
 * Career totals per person. Scores are attributed by checking which side of
 * the match the participant row sits on; unplayed matches are skipped.
 */
export async function rosterStats(ownerId: string): Promise<RosterStat[]> {
  const rows = await query<{
    id: string;
    name: string;
    points_for: string;
    points_against: string;
    matches: string;
    wins: string;
    tournaments: string;
    last_played_at: Date | null;
  }>(
    `WITH participation AS (
       SELECT p.roster_player_id AS person_id,
              m.tournament_id,
              m.played_at,
              CASE WHEN p.id IN (m.team1_p1, m.team1_p2) THEN m.score1 ELSE m.score2 END AS scored,
              CASE WHEN p.id IN (m.team1_p1, m.team1_p2) THEN m.score2 ELSE m.score1 END AS conceded
         FROM players p
         JOIN matches m
           ON m.tournament_id = p.tournament_id
          AND p.id IN (m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2)
        WHERE p.roster_player_id IS NOT NULL
          AND m.score1 IS NOT NULL
     )
     SELECT rp.id,
            rp.name,
            coalesce(sum(pa.scored), 0)                                  AS points_for,
            coalesce(sum(pa.conceded), 0)                                AS points_against,
            count(pa.person_id)                                          AS matches,
            count(pa.person_id) FILTER (WHERE pa.scored > pa.conceded)   AS wins,
            count(DISTINCT pa.tournament_id)                             AS tournaments,
            max(pa.played_at)                                            AS last_played_at
       FROM roster_players rp
       LEFT JOIN participation pa ON pa.person_id = rp.id
      WHERE rp.owner_id = $1
      GROUP BY rp.id, rp.name
      ORDER BY points_for DESC, lower(rp.name)`,
    [ownerId],
  );

  return rows.map((r) => {
    const pointsFor = Number(r.points_for);
    const pointsAgainst = Number(r.points_against);
    return {
      id: r.id,
      name: r.name,
      pointsFor,
      pointsAgainst,
      diff: pointsFor - pointsAgainst,
      matches: Number(r.matches),
      wins: Number(r.wins),
      tournaments: Number(r.tournaments),
      lastPlayedAt: r.last_played_at?.toISOString() ?? null,
    };
  });
}

export async function deleteRosterPlayer(ownerId: string, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new ApiError('Игрок не найден', 404);
  const rows = await query<{ id: string }>(
    'DELETE FROM roster_players WHERE id = $1 AND owner_id = $2 RETURNING id',
    [id, ownerId],
  );
  if (rows.length === 0) throw new ApiError('Игрок не найден', 404);
}
