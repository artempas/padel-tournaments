import type { Match, Player, Standing } from './types';

/**
 * A player's score is the sum of the points their team scored in every match
 * they played. Ties are broken by point difference, then by wins, then name.
 */
export function computeStandings(players: Player[], matches: Match[]): Standing[] {
  const table = new Map<string, Standing>(
    players.map((p) => [
      p.id,
      {
        playerId: p.id,
        name: p.name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        diff: 0,
      },
    ]),
  );

  for (const match of matches) {
    if (match.score1 === null || match.score2 === null) continue;

    const sides: Array<{ ids: [string, string]; scored: number; conceded: number }> = [
      { ids: match.team1, scored: match.score1, conceded: match.score2 },
      { ids: match.team2, scored: match.score2, conceded: match.score1 },
    ];

    for (const side of sides) {
      for (const id of side.ids) {
        const row = table.get(id);
        if (!row) continue;
        row.played++;
        row.pointsFor += side.scored;
        row.pointsAgainst += side.conceded;
        row.diff = row.pointsFor - row.pointsAgainst;
        if (side.scored > side.conceded) row.wins++;
        else if (side.scored === side.conceded) row.draws++;
        else row.losses++;
      }
    }
  }

  return [...table.values()].sort(
    (a, b) =>
      b.pointsFor - a.pointsFor ||
      b.diff - a.diff ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name, 'ru'),
  );
}

/**
 * Сколько раундов каждый просидел на скамейке.
 *
 * Считается по расписанию, а не по сыгранному: раунд без внесённого счёта для
 * скамейки такой же раунд, как остальные. Считай по матчам в таблице — и
 * четвёрка из незаписанного матча выглядела бы отдыхавшей, то есть села бы
 * снова, уже по-настоящему.
 */
export function restCounts(players: Player[], matches: Match[]): Map<string, number> {
  const rounds = new Set(matches.map((m) => m.round));
  const rested = new Map(players.map((p) => [p.id, rounds.size]));

  for (const m of matches) {
    for (const id of [...m.team1, ...m.team2]) {
      const left = rested.get(id);
      if (left !== undefined) rested.set(id, left - 1);
    }
  }

  return rested;
}

/** Players sitting out a given round — everyone not scheduled on a court. */
export function restingInRound(players: Player[], matches: Match[], round: number): Player[] {
  const playing = new Set<string>();
  for (const m of matches) {
    if (m.round !== round) continue;
    for (const id of [...m.team1, ...m.team2]) playing.add(id);
  }
  return players.filter((p) => !playing.has(p.id));
}
