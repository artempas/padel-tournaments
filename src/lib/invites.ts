import { randomBytes } from 'node:crypto';
import { ApiError, parseUuid } from './api';
import { normalizeKey } from './normalize';
import { prisma } from './prisma';

/**
 * Ссылки-приглашения.
 *
 * У клуба одна действующая ссылка: выпуск новой гасит прежнюю. По ней может
 * прийти сколько угодно людей и всегда участником — роль выдаётся потом,
 * руками, и это осознанное решение админа, а не свойство ссылки, которую он
 * когда-то бросил в общий чат.
 *
 * Токен хранится в базе открытым текстом, а не хешем, как у сессий: ссылка
 * должна быть видна на экране клуба с любого устройства и после
 * перезагрузки. Цена этого решения мала — приглашение даёт роль участника и
 * ничего больше.
 */
const INVITE_TTL_DAYS = 7;

export interface IssuedInvite {
  token: string;
  expiresAt: string;
}

export async function issueInvite(clubId: string, createdById: string): Promise<IssuedInvite> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  await prisma.$transaction(async (tx) => {
    // Гасим прежние до вставки новой: «действующая ссылка одна» держится этим
    // порядком, а не индексом — «действует» зависит от now(), и уникальностью
    // такое не выражается.
    await tx.clubInvite.updateMany({
      where: { clubId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.clubInvite.create({
      data: { clubId, token, createdById, expiresAt },
    });
  });

  return { token, expiresAt: expiresAt.toISOString() };
}

/** Действующая ссылка целиком — её можно показать снова на любом устройстве. */
export async function activeInvite(clubId: string): Promise<IssuedInvite | null> {
  const invite = await prisma.clubInvite.findFirst({
    where: { clubId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { token: true, expiresAt: true },
  });

  return invite ? { token: invite.token, expiresAt: invite.expiresAt.toISOString() } : null;
}

export async function revokeInvites(clubId: string): Promise<void> {
  await prisma.clubInvite.updateMany({
    where: { clubId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export interface InvitePreview {
  club: { id: string; name: string; icon: string; color: string };
  /** Игроки клуба, которых ещё никто не занял: из них приглашённый выбирает себя. */
  free: Array<{ id: string; name: string }>;
  /** Пришедший уже состоит в клубе — выбирать нечего, надо просто открыть его. */
  alreadyMember: boolean;
}

async function findLive(token: string) {
  const invite = await prisma.clubInvite.findUnique({
    where: { token },
    select: { clubId: true, revokedAt: true, expiresAt: true },
  });

  if (!invite || invite.revokedAt !== null || invite.expiresAt <= new Date()) {
    throw new ApiError('Ссылка-приглашение недействительна или истекла', 404);
  }
  return invite;
}

/** Что показать на экране приглашения. */
export async function readInvite(token: string, userId: string): Promise<InvitePreview> {
  const invite = await findLive(token);

  const [club, free, membership] = await Promise.all([
    prisma.club.findUniqueOrThrow({
      where: { id: invite.clubId },
      select: { id: true, name: true, icon: true, color: true },
    }),
    prisma.person.findMany({
      where: { clubId: invite.clubId, userId: null, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { nameKey: 'asc' },
    }),
    prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId: invite.clubId, userId } },
      select: { clubId: true },
    }),
  ]);

  return { club, free, alreadyMember: membership !== null };
}

export interface AcceptChoice {
  /** Выбрал себя среди игроков клуба. */
  personId?: unknown;
  /** Или назвался новым именем. */
  newName?: unknown;
}

/** Кем назвался приглашённый: одним из игроков клуба или новым именем. */
type Claim = { personId: string } | { name: string };

function readClaim(choice: AcceptChoice): Claim {
  const hasPerson = choice.personId !== undefined && choice.personId !== null;
  const hasName = choice.newName !== undefined && choice.newName !== null;

  if (hasPerson === hasName) {
    throw new ApiError('Выберите себя среди игроков клуба или назовите новое имя');
  }

  if (hasPerson) {
    // Кривой uuid Postgres встретит ошибкой типа, а человеку нужен ответ.
    return { personId: parseUuid(String(choice.personId), 'Игрок не найден') };
  }

  const name = String(choice.newName).trim();
  if (!name || name.length > 40) {
    throw new ApiError('Имя игрока обязательно (до 40 символов)');
  }
  return { name };
}

/**
 * Вступление в клуб. Членство и связь игрока пишутся одной транзакцией — по
 * отдельности их не бывает.
 *
 * Повторный переход по той же ссылке ничего не ломает: тот, кто уже в клубе,
 * просто получает его id. Так двойной тап по кнопке не превращается в ошибку.
 */
export async function acceptInvite(
  token: string,
  userId: string,
  choice: AcceptChoice,
): Promise<string> {
  const invite = await findLive(token);
  const clubId = invite.clubId;

  const existing = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { clubId: true },
  });
  if (existing) return clubId;

  const claim = readClaim(choice);

  await prisma.$transaction(async (tx) => {
    if ('personId' in claim) {
      // updateMany с полным набором условий вместо update по id: чужой,
      // архивный или уже занятый игрок должен дать «не найден», а не
      // молчаливую перезапись.
      const { count } = await tx.person.updateMany({
        where: { id: claim.personId, clubId, userId: null, archivedAt: null },
        data: { userId },
      });
      if (count === 0) throw new ApiError('Этот игрок уже занят или не найден', 409);
    } else {
      const nameKey = normalizeKey(claim.name);

      // Тёзка в клубе — почти наверняка он же и есть: имена в ростере
      // уникальны, и вторым «Артёмом» стать нельзя. Отвечаем текстом, а не
      // ошибкой уникальности, потому что человеку есть что с этим сделать.
      const taken = await tx.person.findUnique({
        where: { clubId_nameKey: { clubId, nameKey } },
        select: { id: true },
      });
      if (taken) {
        throw new ApiError('Игрок с таким именем в клубе уже есть — выберите его в списке', 409);
      }

      await tx.person.create({ data: { clubId, name: claim.name, nameKey, userId } });
    }

    await tx.clubMember.create({ data: { clubId, userId, role: 'member' } });
  });

  return clubId;
}
