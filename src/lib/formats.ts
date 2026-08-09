import { totalMatchesFor } from './americano.ts';
import { matchesPerRound } from './mexicano.ts';
import type { Match, PlayableFormat, TournamentFormat } from './types';

export interface FormatOption {
  value: PlayableFormat;
  label: string;
  hint: string;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'americano',
    label: 'Американо',
    hint: 'Пары тасуются так, чтобы каждый сыграл с каждым. Длина турнира из этого и следует.',
  },
  {
    value: 'mexicano',
    label: 'Мексикано',
    hint: 'Пары следующего раунда собираются по таблице: лидеры на первом корте, 1-й с 4-м против 2-го с 3-м. Раунд появляется, когда доигран предыдущий.',
  },
];

export function formatLabel(format: TournamentFormat): string {
  return FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? format;
}

/**
 * Матч, которого раунд ещё ждёт: без счёта и не пропущенный.
 *
 * Отсюда следует, доигран ли раунд, — а у мексикано это ровно тот вопрос,
 * после которого собирается следующий. Правило одно на сервер и на клиент
 * (`extendMexicano` и подсветка текущего раунда), потому что расходиться им
 * нельзя: экран обещает составы там, где их соберёт сервер.
 *
 * Пропущенный матч раунд не держит, но и сыгранным не становится: счёта у него
 * по-прежнему нет, и турнир останется недоигранным, пока счёт не внесут или
 * организатор не завершит турнир досрочно.
 */
export function awaitsScore(match: Match): boolean {
  return match.score1 === null && !match.skipped;
}

/**
 * Сколько матчей и раундов будет в турнире.
 *
 * У американо это следствие состава, у мексикано — числа раундов, которое
 * задаёт организатор. Считается одинаково и до старта (предпросмотр в форме),
 * и после (прогресс в списке): у мексикано матчи создаются по ходу дела, и
 * `matches.length` до конца турнира меньше настоящего итога.
 *
 * `builtMatches` — сколько матчей уже стоит в расписании. Это нижняя граница
 * итога: продлённое американо длиннее, чем «каждый с каждым», и без неё
 * прогресс дорос бы до 17/14. У мексикано граница ни на что не влияет —
 * созданного там всегда не больше запланированного.
 */
export function tournamentSize(
  format: TournamentFormat,
  playerCount: number,
  courts: number,
  roundsPlanned: number | null,
  builtMatches = 0,
): { matches: number; rounds: number } {
  const perRound = Math.max(1, matchesPerRound(playerCount, courts));

  if (format === 'mexicano' && roundsPlanned !== null) {
    return { matches: Math.max(perRound * roundsPlanned, builtMatches), rounds: roundsPlanned };
  }

  const matches = Math.max(totalMatchesFor(playerCount), builtMatches);
  return { matches, rounds: Math.ceil(matches / perRound) };
}

/**
 * Раунды, которых ещё нет в базе.
 *
 * У мексикано пары — функция от таблицы, поэтому раньше времени их не
 * существует. Но сколько раундов впереди и сколько кортов займёт каждый,
 * известно с самого начала, и это стоит показать: расписание видно целиком,
 * просто у будущих матчей вместо составов пусто.
 */
export function upcomingRounds(
  format: TournamentFormat,
  playerCount: number,
  courts: number,
  roundsPlanned: number | null,
  builtRounds: number,
): Array<{ round: number; matches: number }> {
  if (format !== 'mexicano' || roundsPlanned === null) return [];

  const perRound = matchesPerRound(playerCount, courts);
  const pending: Array<{ round: number; matches: number }> = [];
  for (let round = builtRounds + 1; round <= roundsPlanned; round++) {
    pending.push({ round, matches: perRound });
  }
  return pending;
}
