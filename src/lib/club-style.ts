/**
 * Внешность клуба: значок, палитра и предел длины названия.
 *
 * Отдельный модуль от lib/clubs.ts, и не ради порядка: тот ходит в базу, а
 * значок рисуют клиентские компоненты. Импортируй они константы оттуда —
 * вместе с ними в браузерный бандл уехал бы Prisma со всем драйвером pg.
 *
 * Список цветов повторён в @theme из globals.css и в CHECK clubs_color_known.
 * Три копии на одну правду многовато, но каждая нужна своей стороне: css знает
 * значения, база — что чужого не примет, а этот файл — как их показать.
 */

export const CLUB_COLORS = [
  { id: 'lime', label: 'Лайм', swatch: 'bg-club-lime' },
  { id: 'sky', label: 'Небо', swatch: 'bg-club-sky' },
  { id: 'violet', label: 'Фиалка', swatch: 'bg-club-violet' },
  { id: 'amber', label: 'Янтарь', swatch: 'bg-club-amber' },
  { id: 'rose', label: 'Роза', swatch: 'bg-club-rose' },
  { id: 'teal', label: 'Бирюза', swatch: 'bg-club-teal' },
] as const;

export type ClubColor = (typeof CLUB_COLORS)[number]['id'];

/**
 * Классы фона по id. Записаны словами, а не собраны из `bg-club-${color}`:
 * Tailwind ищет имена классов в исходнике текстом и вычисленных не видит.
 * Тот же приём, что у ступеней рейтинга в RosterView.
 */
export const CLUB_BACKGROUND: Record<string, string> = {
  lime: 'bg-club-lime',
  sky: 'bg-club-sky',
  violet: 'bg-club-violet',
  amber: 'bg-club-amber',
  rose: 'bg-club-rose',
  teal: 'bg-club-teal',
};

/**
 * Значки на выбор. Ограниченный набор вместо свободного ввода: клавиатуры с
 * эмодзи есть не у всех, а промахнуться мимо непечатного символа легко.
 */
export const CLUB_ICONS = [
  '🎾', '🏆', '🔥', '⚡', '🌊', '🌴', '🦅', '🐺',
  '🎯', '💪', '🚀', '⭐', '🍋', '🌙', '🎪', '🏝',
] as const;

export const CLUB_NAME_MAX = 40;
