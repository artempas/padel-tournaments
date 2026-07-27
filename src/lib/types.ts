export interface Player {
  id: string;
  name: string;
  seat: number;
}

export interface Match {
  id: string;
  round: number;
  court: number;
  team1: [string, string];
  team2: [string, string];
  score1: number | null;
  score2: number | null;
}

/** Пока генератор есть только у американо, но схема допускает и остальные. */
export type TournamentFormat = 'americano' | 'mexicano' | 'team_americano';

export interface Tournament {
  id: string;
  name: string;
  courts: number;
  format: TournamentFormat;
  pointsPerMatch: number;
  status: 'running' | 'finished';
  /** Finished by the organiser rather than by playing every match. */
  closedEarly: boolean;
  createdAt: string;
  finishedAt: string | null;
}

export interface TournamentDetail extends Tournament {
  players: Player[];
  matches: Match[];
}

export interface TournamentSummary extends Tournament {
  playerCount: number;
  matchCount: number;
  playedCount: number;
}

export interface Standing {
  playerId: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
}
