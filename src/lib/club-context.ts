import { cookies } from 'next/headers';
import { ApiError, parseUuid } from './api';
import { getCurrentUser, type SessionUser } from './auth';
import type { ClubRole } from './permissions';
import { prisma } from './prisma';

/**
 * Текущий клуб и права в нём.
 *
 * Клуб не попадает в URL: турнир адресуется своим id, а можно ли его открыть,
 * выводится из членства в `tournament.club_id`. Поэтому «в каком клубе я
 * сейчас» — это состояние пользователя, а не адрес страницы, и живёт оно в
 * cookie. Ставит её один роут — POST /api/clubs/[id]/switch, — потому что
 * серверные компоненты писать cookie не умеют.
 *
 * Cookie — подсказка, а не право: каждое чтение сверяется с club_members, и
 * протухшая ссылка на клуб, из которого человек вышел, просто игнорируется.
 */
export const CLUB_COOKIE = 'padel_club';

const CLUB_COOKIE_DAYS = 365;

export interface ClubBrief {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface Membership {
  user: SessionUser;
  club: ClubBrief;
  role: ClubRole;
  /**
   * Игрок, которым пользователь выступает в этом клубе. Есть у каждого
   * участника — за этим следит отложенный триггер `club_members_have_player`,
   * поэтому здесь не `string | null`, и вызывающим не нужна ветка «а вдруг».
   */
  personId: string;
  /**
   * Его имя. Не то же самое, что displayName аккаунта: в одном клубе человек
   * «Артём», в другом «Тёма», а звать аккаунт могут иначе, чем обоих.
   */
  personName: string;
}

// Значение из cookie приходит от клиента: до похода в базу его стоит отсеять,
// иначе Postgres ответит ошибкой типа на «сломанный» uuid.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMBERSHIP_SELECT = {
  role: true,
  club: {
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
    },
  },
} as const;

/** Игрок этого пользователя в этом клубе. Инвариант обещает ровно одного. */
async function playerIn(clubId: string, userId: string): Promise<{ id: string; name: string }> {
  const person = await prisma.person.findFirst({
    where: { clubId, userId },
    select: { id: true, name: true },
  });

  if (!person) {
    // Сюда можно попасть только если триггер снесли руками. Молчать нельзя:
    // дальше поедут запросы, которые считают связь существующей.
    throw new ApiError('Участник клуба не связан с игроком', 500);
  }
  return person;
}

/**
 * Членство в конкретном клубе. Для API, где клуб назван в адресе: чужой или
 * несуществующий клуб — это 404, а не молчаливый переход в другой.
 */
export async function membershipIn(user: SessionUser, id: string): Promise<Membership> {
  const clubId = parseUuid(id, 'Клуб не найден');

  const row = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId: user.id } },
    select: MEMBERSHIP_SELECT,
  });

  // 404, а не 403: существует клуб или нет — не дело того, кто в нём не состоит.
  if (!row) throw new ApiError('Клуб не найден', 404);

  const person = await playerIn(clubId, user.id);
  return { user, club: row.club, role: row.role, personId: person.id, personName: person.name };
}

/**
 * Клуб, в котором пользователь сейчас работает: из cookie, а если её нет или
 * она указывает на покинутый клуб — первый по времени вступления.
 *
 * `null` значит, что клубов у пользователя нет вообще. Такое бывает ровно у
 * того, кто отдал свой клуб и вышел отовсюду; страницы это состояние не
 * разбирают, его ловит один общий redirect на создание клуба.
 */
export async function currentMembership(user: SessionUser): Promise<Membership | null> {
  const store = await cookies();
  const preferred = store.get(CLUB_COOKIE)?.value;

  const row =
    (preferred && UUID_LIKE.test(preferred)
      ? await prisma.clubMember.findUnique({
          where: { clubId_userId: { clubId: preferred, userId: user.id } },
          select: MEMBERSHIP_SELECT,
        })
      : null) ??
    (await prisma.clubMember.findFirst({
      where: { userId: user.id },
      orderBy: [{ joinedAt: 'asc' }, { clubId: 'asc' }],
      select: MEMBERSHIP_SELECT,
    }));

  if (!row) return null;

  const person = await playerIn(row.club.id, user.id);
  return { user, club: row.club, role: row.role, personId: person.id, personName: person.name };
}

/**
 * Вход и клуб разом — то, с чего начинается каждый защищённый роут API.
 * Отсутствие клуба здесь ошибка: у любого вошедшего он есть, а кто остался
 * без клубов, до API просто не доходит — страница увела его на создание.
 */
export async function requireMembership(): Promise<Membership> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError('Требуется вход', 401);

  const membership = await currentMembership(user);
  if (!membership) throw new ApiError('Сначала создайте клуб', 409);
  return membership;
}

/** То же для роутов, где клуб назван в адресе. */
export async function requireMembershipIn(id: string): Promise<Membership> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError('Требуется вход', 401);
  return membershipIn(user, id);
}

/**
 * Членство в клубе, которому принадлежит турнир.
 *
 * Не текущий клуб из cookie: турнир адресуется собственным id, и ссылка на
 * него должна открываться независимо от того, какой клуб человек выбрал в
 * селекторе. Клуб турнира — единственный, чьи права здесь что-то значат.
 */
export async function requireMembershipForTournament(id: string): Promise<Membership> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError('Требуется вход', 401);

  const tournamentId = parseUuid(id, 'Турнир не найден');
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { clubId: true },
  });
  // 404 и здесь, и у чужого клуба: существует турнир или нет — не дело того,
  // кто к нему отношения не имеет.
  if (!tournament) throw new ApiError('Турнир не найден', 404);

  try {
    return await membershipIn(user, tournament.clubId);
  } catch {
    throw new ApiError('Турнир не найден', 404);
  }
}

/** Клубы пользователя для селектора — в том же порядке, что и запасной выбор. */
export async function listMyClubs(userId: string): Promise<Array<ClubBrief & { role: ClubRole }>> {
  const rows = await prisma.clubMember.findMany({
    where: { userId },
    orderBy: [{ joinedAt: 'asc' }, { clubId: 'asc' }],
    select: MEMBERSHIP_SELECT,
  });

  return rows.map((r) => ({ ...r.club, role: r.role }));
}

export async function setCurrentClub(clubId: string): Promise<void> {
  const store = await cookies();
  store.set(CLUB_COOKIE, clubId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(Date.now() + CLUB_COOKIE_DAYS * 86_400_000),
  });
}

/** Забыть выбор — на выходе из аккаунта и при выходе из показанного клуба. */
export async function clearCurrentClub(): Promise<void> {
  const store = await cookies();
  store.delete(CLUB_COOKIE);
}
