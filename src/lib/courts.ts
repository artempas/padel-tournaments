/** A side contains one singles player or two doubles partners. */
export type Team<T = string> = [T] | [T, T];

export interface CourtConfig {
  doubles: number;
  singles: number;
}

/** Older API responses and offline snapshots describe doubles courts only. */
export function courtConfig(t: { courts: number; singlesCourts?: number }): CourtConfig {
  const singles = t.singlesCourts ?? 0;
  return { doubles: t.courts - singles, singles };
}

export function validateCourts(config: CourtConfig): void {
  if (!Number.isInteger(config.doubles) || !Number.isInteger(config.singles) ||
      config.doubles < 0 || config.singles < 0 ||
      config.doubles + config.singles < 1 || config.doubles + config.singles > 16) {
    throw new Error('Укажите от 1 до 16 кортов суммарно; количества должны быть целыми и неотрицательными');
  }
}

/** Keep both kinds in use when at least six players can take the court. */
export function activeCourts(playerCount: number, config: CourtConfig): CourtConfig {
  const reserve = config.doubles > 0 && config.singles > 0 && playerCount >= 6 ? 2 : 0;
  const doubles = Math.min(config.doubles, Math.floor((playerCount - reserve) / 4));
  return { doubles, singles: Math.min(config.singles, Math.floor((playerCount - doubles * 4) / 2)) };
}

export function courtNumbers(playerCount: number, config: CourtConfig): number[] {
  const active = activeCourts(playerCount, config);
  return [
    ...Array.from({ length: active.doubles }, (_, i) => i + 1),
    ...Array.from({ length: active.singles }, (_, i) => config.doubles + i + 1),
  ];
}

export function courtLabel(config: CourtConfig): string {
  return [config.doubles > 0 ? `${config.doubles} × 2 на 2` : '',
    config.singles > 0 ? `${config.singles} × 1 на 1` : ''].filter(Boolean).join(' · ');
}
