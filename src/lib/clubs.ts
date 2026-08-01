import { ApiError, parseUuid } from './api';
import type { ClubBrief } from './club-context';
import { CLUB_COLORS, CLUB_ICONS, CLUB_NAME_MAX, type ClubColor } from './club-style';
import { normalizeKey } from './normalize';
import { canAssignRole, canRemoveMember, type ClubRole } from './permissions';
import { prisma } from './prisma';

/**
 * Клуб: создание, состав и роли.
 *
 * Всё, что меняет состав, идёт транзакцией: членство и связь игрока с
 * аккаунтом существуют только вместе (отложенный триггер
 * `club_members_have_player`), и разнести их по двум запросам нельзя.
 */

const COLOR_IDS = new Set<string>(CLUB_COLORS.map((c) => c.id));
const ICON_SET = new Set<string>(CLUB_ICONS);

export interface CreateClubInput {
  name?: unknown;
  icon?: unknown;
  color?: unknown;
  /** Имя владельца как игрока: участник клуба всегда и игрок клуба. */
  playerName?: unknown;
}

interface ValidClub {
  name: string;
  icon: string;
  color: ClubColor;
  playerName: string;
}

export function validateClubInput(input: CreateClubInput): ValidClub {
  const name = String(input.name ?? '').trim();
  if (!name || name.length > CLUB_NAME_MAX) {
    throw new ApiError(`Название клуба обязательно (до ${CLUB_NAME_MAX} символов)`);
  }

  const icon = String(input.icon ?? '🎾');
  if (!ICON_SET.has(icon)) throw new ApiError('Неизвестный значок клуба');

  const color = String(input.color ?? 'lime');
  if (!COLOR_IDS.has(color)) throw new ApiError('Неизвестный цвет клуба');

  const playerName = String(input.playerName ?? '').trim();
  if (!playerName || playerName.length > 40) {
    throw new ApiError('Ваше имя как игрока обязательно (до 40 символов)');
  }

  return { name, icon, color: color as ClubColor, playerName };
}

/**
 * Заводит клуб и сразу же владельца в нём — вместе с его игроком.
 *
 * Три вставки одной транзакцией не по вкусу, а по необходимости: клуб без
 * владельца и участник без игрока запрещены отложенными триггерами, и порознь
 * ни одна из этих строк существовать не может.
 */
export async function createClub(userId: string, input: CreateClubInput): Promise<string> {
  const { name, icon, color, playerName } = validateClubInput(input);

  return prisma.$transaction(async (tx) => {
    const club = await tx.club.create({
      data: { name, icon, color },
      select: { id: true },
    });

    await tx.person.create({
      data: { clubId: club.id, name: playerName, nameKey: normalizeKey(playerName), userId },
    });

    await tx.clubMember.create({
      data: { clubId: club.id, userId, role: 'owner' },
    });

    return club.id;
  });
}

export interface UpdateClubInput {
  name?: unknown;
  icon?: unknown;
  color?: unknown;
}

export async function updateClub(clubId: string, input: UpdateClubInput): Promise<ClubBrief> {
  const name = String(input.name ?? '').trim();
  if (!name || name.length > CLUB_NAME_MAX) {
    throw new ApiError(`Название клуба обязательно (до ${CLUB_NAME_MAX} символов)`);
  }

  const icon = String(input.icon ?? '');
  if (!ICON_SET.has(icon)) throw new ApiError('Неизвестный значок клуба');

  const color = String(input.color ?? '');
  if (!COLOR_IDS.has(color)) throw new ApiError('Неизвестный цвет клуба');

  return prisma.club.update({
    where: { id: clubId },
    data: { name, icon, color },
    select: { id: true, name: true, icon: true, color: true },
  });
}

export interface ClubMemberRow {
  userId: string;
  displayName: string;
  role: ClubRole;
  joinedAt: string;
  /** Игрок, которым этот человек выступает: есть всегда. */
  personId: string;
  playerName: string;
}

/**
 * Состав клуба. Владелец первым, дальше по времени вступления — так список
 * читается сверху вниз как история клуба.
 */
export async function listMembers(clubId: string): Promise<ClubMemberRow[]> {
  const rows = await prisma.clubMember.findMany({
    where: { clubId },
    orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: { select: { displayName: true } },
    },
  });

  // Игроки одним запросом вместо N: строка членства знает аккаунт, а имя
  // игрока лежит в people, и связывает их пара (club_id, user_id).
  const people = await prisma.person.findMany({
    where: { clubId, userId: { in: rows.map((r) => r.userId) } },
    select: { id: true, name: true, userId: true },
  });
  const byUser = new Map(people.map((p) => [p.userId!, p]));

  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.user.displayName,
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
    personId: byUser.get(r.userId)!.id,
    playerName: byUser.get(r.userId)!.name,
  }));
}

async function roleOf(clubId: string, userId: string): Promise<ClubRole> {
  const row = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { role: true },
  });
  if (!row) throw new ApiError('Участник не найден', 404);
  return row.role;
}

export async function setMemberRole(
  clubId: string,
  actorRole: ClubRole,
  targetUserId: string,
  next: ClubRole,
): Promise<void> {
  const userId = parseUuid(targetUserId, 'Участник не найден');
  const target = await roleOf(clubId, userId);

  if (!canAssignRole(actorRole, target, next)) {
    throw new ApiError('Такую роль вы назначить не можете', 403);
  }

  await prisma.clubMember.update({
    where: { clubId_userId: { clubId, userId } },
    data: { role: next },
  });
}

/**
 * Выход из клуба и удаление участника — одно и то же для базы: пропадает
 * членство, а игрок остаётся анонимным, со всей своей историей. Отличаются
 * только права на вызов и текст подтверждения на экране.
 *
 * Связь снимается в той же транзакции: участник без игрока и игрок с
 * аккаунтом, который в клубе не состоит, одинаково запрещены триггером.
 */
export async function removeMember(clubId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.clubMember.deleteMany({ where: { clubId, userId } });
    if (count === 0) throw new ApiError('Участник не найден', 404);

    await tx.person.updateMany({
      where: { clubId, userId },
      data: { userId: null },
    });
  });
}

export async function removeMemberAs(
  clubId: string,
  actorRole: ClubRole,
  targetUserId: string,
): Promise<void> {
  const userId = parseUuid(targetUserId, 'Участник не найден');
  const target = await roleOf(clubId, userId);

  if (!canRemoveMember(actorRole, target)) {
    throw new ApiError('Удалять участников может только владелец клуба', 403);
  }

  await removeMember(clubId, userId);
}

/**
 * Передача клуба. Бывший владелец становится администратором — отдать клуб и
 * потерять к нему доступ разом никто не хочет, а понизить себя дальше он
 * потом может сам, выйдя из клуба.
 *
 * Одной транзакцией: между двумя UPDATE владельцев двое, и только
 * отложенность триггера `club_members_single_owner` позволяет этому мигу
 * существовать.
 */
export async function transferOwnership(
  clubId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const target = parseUuid(toUserId, 'Участник не найден');
  if (target === fromUserId) throw new ApiError('Клуб уже ваш');

  await prisma.$transaction(async (tx) => {
    const next = await tx.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: target } },
      select: { role: true },
    });
    if (!next) throw new ApiError('Участник не найден', 404);

    await tx.clubMember.update({
      where: { clubId_userId: { clubId, userId: fromUserId } },
      data: { role: 'admin' },
    });
    await tx.clubMember.update({
      where: { clubId_userId: { clubId, userId: target } },
      data: { role: 'owner' },
    });
  });
}
