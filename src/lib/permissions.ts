/**
 * Кто что может в клубе.
 *
 * Единственное место, где это записано. Модуль чистый — ни базы, ни сессии,
 * ни Prisma: правило «админ может продлить турнир» не должно зависеть от
 * того, откуда приехала роль, и проверяется тестом наравне с генератором
 * расписания. Сервер зовёт эти функции перед записью, клиент — перед тем как
 * рисовать кнопку; расходиться им негде, потому что функция одна.
 *
 * Скрытие кнопки — вежливость, а не защита: отказ всё равно приходит с
 * сервера, и любой роут проверяет права сам.
 */

export type ClubRole = 'member' | 'admin' | 'owner';

/**
 * Роли упорядочены, и порядок — часть правил: «повысить не выше себя» и «не
 * трогать равного» сравнивают именно эти числа. Тот же порядок у значений
 * enum club_role в схеме.
 */
const RANK: Record<ClubRole, number> = { member: 0, admin: 1, owner: 2 };

export function isAtLeast(role: ClubRole, floor: ClubRole): boolean {
  return RANK[role] >= RANK[floor];
}

/**
 * Действия, право на которые зависит только от роли. Счёт сюда не входит:
 * участнику его разрешает не роль, а участие в матче — см. canScore.
 */
export type ClubAction =
  | 'club:edit'
  | 'club:transfer'
  | 'club:leave'
  | 'member:invite'
  | 'member:role'
  | 'member:remove'
  | 'roster:archive'
  | 'tournament:create'
  | 'tournament:delete'
  | 'tournament:close'
  | 'tournament:extend';

/**
 * Минимальная роль для каждого действия.
 *
 * Удаление турнира стоит особняком: администратор заводит турниры и может
 * завершить их досрочно, но не стереть. Досрочное завершение обратимо, а
 * удаление уносит с собой историю всех участников — это владелец.
 */
const FLOOR: Record<ClubAction, ClubRole> = {
  'club:edit': 'admin',
  'club:transfer': 'owner',
  // Владелец выйти не может: клуб остался бы без владельца. Сначала передать.
  'club:leave': 'member',
  'member:invite': 'admin',
  'member:role': 'admin',
  'member:remove': 'owner',
  'roster:archive': 'admin',
  'tournament:create': 'admin',
  'tournament:delete': 'owner',
  'tournament:close': 'admin',
  'tournament:extend': 'admin',
};

export function can(role: ClubRole, action: ClubAction): boolean {
  if (action === 'club:leave') return role !== 'owner';
  return isAtLeast(role, FLOOR[action]);
}

/** Что известно о матче в момент, когда в него вносят счёт. */
export interface ScoreContext {
  /** Актор стоит в четвёрке этого матча. */
  playing: boolean;
  /** Турнир ещё не завершён — ни доигран, ни закрыт досрочно. */
  running: boolean;
}

/**
 * Счёт своего матча участник ведёт сам, пока турнир идёт: на корте считает
 * тот, кто играет, и гонять за организатором после каждой партии незачем.
 * Опечатку он тоже правит сам — до тех пор, пока турнир не кончился. После
 * этого результат становится историей, и трогать её может только админ.
 */
export function canScore(role: ClubRole, ctx: ScoreContext): boolean {
  if (isAtLeast(role, 'admin')) return true;
  return ctx.playing && ctx.running;
}

/**
 * Смена роли участнику. Два запрета вместо одного:
 *
 *   не выше себя  — иначе админ назначил бы себе равного и потерял контроль
 *                   над тем, кого только что повысил;
 *   не равного и не старшего — админы друг другу не начальники, а владелец
 *                   не понижается никем.
 *
 * Владельца этой дорогой не назначить: владелец в клубе ровно один, и его
 * смена — это передача клуба, отдельное действие с подтверждением.
 */
export function canAssignRole(actor: ClubRole, target: ClubRole, next: ClubRole): boolean {
  if (!can(actor, 'member:role')) return false;
  if (next === 'owner') return false;
  if (RANK[target] >= RANK[actor]) return false;
  return RANK[next] <= RANK[actor];
}

/** Удалить участника может владелец, и только младшего — то есть любого, кроме себя. */
export function canRemoveMember(actor: ClubRole, target: ClubRole): boolean {
  if (!can(actor, 'member:remove')) return false;
  return RANK[target] < RANK[actor];
}

export const ROLE_LABELS: Record<ClubRole, string> = {
  member: 'Участник',
  admin: 'Администратор',
  owner: 'Владелец',
};
