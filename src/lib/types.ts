import type { Rating } from './rating';

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

/** Схема допускает и team_americano, но генератора у него пока нет. */
export type TournamentFormat = 'americano' | 'mexicano' | 'team_americano';

/** Форматы, которые приложение умеет составлять. */
export type PlayableFormat = Extract<TournamentFormat, 'americano' | 'mexicano'>;

export interface Tournament {
  id: string;
  name: string;
  courts: number;
  format: TournamentFormat;
  /** Длина турнира в раундах — только у mexicano, у остальных null. */
  roundsPlanned: number | null;
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
  /**
   * Рейтинг участников на начало турнира, по Player.id.
   *
   * Отсюда клиент сам считает, сколько турнир кому принёс: прогоняет свои
   * матчи через `computeRatings` поверх этого состояния. Поэтому дельта
   * пересчитывается сразу при вводе счёта и живёт без сети — как и таблица.
   */
  ratingBefore: Record<string, Rating>;
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
