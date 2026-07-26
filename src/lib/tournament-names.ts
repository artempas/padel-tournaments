/**
 * Random tournament names, so the organiser never has to stare at an empty
 * field. All nouns are masculine singular, which keeps adjective agreement
 * correct without needing a morphology table.
 */

const NOUNS = [
  'американо',
  'турнир',
  'слэм',
  'батл',
  'сет',
  'корт',
  'раунд',
  'кубок',
  'матч',
  'разогрев',
  'челлендж',
  'марафон',
];

const ADJECTIVES = [
  'дружеский',
  'жаркий',
  'быстрый',
  'королевский',
  'чемпионский',
  'домашний',
  'легендарный',
  'весенний',
  'решающий',
  'яростный',
  'золотой',
  'открытый',
  'внезапный',
  'эпический',
  'клубный',
];

/** Index 0 is Sunday, matching Date#getDay. */
const WEEKDAY_ADJECTIVES = [
  'воскресный',
  'понедельничный',
  'вторничный',
  'средовой',
  'четверговый',
  'пятничный',
  'субботний',
];

const TIME_ADJECTIVES = ['утренний', 'дневной', 'вечерний', 'ночной'];

function timeAdjective(hour: number): string {
  if (hour < 6) return TIME_ADJECTIVES[3];
  if (hour < 12) return TIME_ADJECTIVES[0];
  if (hour < 18) return TIME_ADJECTIVES[1];
  return TIME_ADJECTIVES[2];
}

function capitalise(word: string): string {
  return word.charAt(0).toLocaleUpperCase('ru') + word.slice(1);
}

export interface NameOptions {
  now?: Date;
  random?: () => number;
}

/**
 * Roughly half the time the name nods to when the tournament is happening
 * ("Пятничный американо", "Вечерний слэм"); otherwise it is a free adjective.
 */
export function randomTournamentName(options: NameOptions = {}): string {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length) % items.length];

  const roll = random();
  const adjective =
    roll < 0.3
      ? WEEKDAY_ADJECTIVES[now.getDay()]
      : roll < 0.5
        ? timeAdjective(now.getHours())
        : pick(ADJECTIVES);

  return `${capitalise(adjective)} ${pick(NOUNS)}`;
}
