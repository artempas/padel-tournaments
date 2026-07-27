import type { TournamentDetail } from './types';

/** A score entered on the phone that the server has not accepted yet. */
export interface PendingScore {
  tournamentId: string;
  matchId: string;
  /** Both null means the organiser cleared the result. */
  score1: number | null;
  score2: number | null;
  /** `Date.now()` at the moment of entry — decides who wins for one match. */
  queuedAt: number;
}

/**
 * Lays queued scores over the last state the server sent, which is what the
 * organiser must see: the queue only ever holds changes the server has not
 * accepted, so applying it to any server snapshot gives the current truth.
 *
 * Status is recomputed the same way the server does it (see `refreshStatus`),
 * so the final table opens on the last match even with no connection.
 * `finishedAt` is not invented — once the queue drains the server's value wins.
 */
export function applyPendingScores(
  tournament: TournamentDetail,
  pending: PendingScore[],
): TournamentDetail {
  const byMatch = new Map<string, PendingScore>();
  for (const entry of pending) {
    if (entry.tournamentId !== tournament.id) continue;
    const seen = byMatch.get(entry.matchId);
    if (!seen || seen.queuedAt <= entry.queuedAt) byMatch.set(entry.matchId, entry);
  }
  if (byMatch.size === 0) return tournament;

  const matches = tournament.matches.map((match) => {
    const entry = byMatch.get(match.id);
    return entry ? { ...match, score1: entry.score1, score2: entry.score2 } : match;
  });

  const done = tournament.closedEarly || matches.every((m) => m.score1 !== null);

  return {
    ...tournament,
    matches,
    status: done ? 'finished' : 'running',
    finishedAt: done ? tournament.finishedAt : null,
  };
}
