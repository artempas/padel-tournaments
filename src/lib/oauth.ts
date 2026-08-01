import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { CLUB_NAME_MAX } from './club-style';
import { createClub } from './clubs';
import { uniqueViolationOn } from './db-errors';
import { normalizeKey } from './normalize';
import { prisma } from './prisma';
import { NAME_MAX, authorizeUrl, safeNext, type YandexConfig, type YandexIdentity } from './yandex';

/**
 * Вход через внешний сервис: рукопожатие и связь с аккаунтом приложения.
 *
 * Разделение с lib/yandex.ts проходит по границе «чужое — своё»: там разговор
 * с Яндексом, здесь наши куки, наши пользователи и наши клубы.
 */

export const OAUTH_COOKIE = 'padel_oauth';

/** Столько же живёт код подтверждения у Яндекса — дольше держать нечего. */
const HANDSHAKE_TTL_S = 600;

/**
 * Зачем человек пошёл на Яндекс: войти или привязать Яндекс к аккаунту, в
 * который он уже вошёл.
 *
 * Намерение записывается в начале, а не выводится из наличия сессии в конце.
 * Разница видна, когда сессия истекла, пока человек был на Яндексе: выведи мы
 * намерение по сессии, привязка молча обернулась бы созданием второго
 * аккаунта — а так это честная ошибка «войдите и повторите».
 */
export type OauthIntent = 'login' | 'link';

interface Handshake {
  state: string;
  verifier: string;
  next: string;
  intent: OauthIntent;
}

/**
 * Состояние рукопожатия живёт в httpOnly-куке, а не в базе, как WebAuthn-
 * challenge. Причина в том, кто с чем сверяется: challenge нельзя отдавать
 * клиенту, потому что клиент на нём подписывает, а `state` клиент и так видит
 * в адресной строке — весь его смысл в том, что вернувшийся из Яндекса адрес
 * сверяется с тем, что лежит в куке этого браузера. Подделать её нельзя, и
 * лишняя таблица с уборкой протухших строк ничего к этому не добавит.
 */
async function saveHandshake(handshake: Handshake): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_COOKIE, Buffer.from(JSON.stringify(handshake)).toString('base64url'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: HANDSHAKE_TTL_S,
  });
}

/**
 * Читает и стирает рукопожатие: одноразовое по построению, как и challenge.
 * Кука снимается в любом случае — и при отказе, и при ошибке, — иначе
 * брошенная попытка осталась бы висеть в браузере до конца своих десяти минут.
 */
export async function takeHandshake(): Promise<Handshake | null> {
  const store = await cookies();
  const raw = store.get(OAUTH_COOKIE)?.value;
  store.delete(OAUTH_COOKIE);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Partial<Handshake>;
    if (!parsed.state || !parsed.verifier) return null;

    return {
      state: parsed.state,
      verifier: parsed.verifier,
      next: safeNext(parsed.next),
      intent: parsed.intent === 'link' ? 'link' : 'login',
    };
  } catch {
    return null;
  }
}

/**
 * Начало входа: свежие `state` и PKCE-пара, кука на время похода и адрес
 * экрана согласия.
 */
export async function beginYandexHandshake(
  config: YandexConfig,
  params: { next: string; intent: OauthIntent },
): Promise<string> {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');

  await saveHandshake({ state, verifier, next: params.next, intent: params.intent });

  return authorizeUrl(config, { state, codeChallenge });
}

/**
 * Обновляет снимок логина и почты: в Яндексе они могли смениться.
 *
 * `updateMany`, а не `update`: строку могли отвязать в соседней вкладке между
 * чтением и записью, и падать из-за этого входу незачем. Имя аккаунта при этом
 * не трогается — человек мог назваться в Яндексе как угодно, а под прежним
 * именем он уже записан в таблицах турниров.
 */
async function touchAccount(identity: YandexIdentity): Promise<void> {
  await prisma.oauthAccount.updateMany({
    where: { provider: 'yandex', providerAccountId: identity.subject },
    data: { login: identity.login, email: identity.email, lastLoginAt: new Date() },
  });
}

async function findAccount(subject: string): Promise<{ userId: string } | null> {
  return prisma.oauthAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'yandex', providerAccountId: subject } },
    select: { userId: true },
  });
}

/**
 * Заводит аккаунт под человека из Яндекса — вместе с личным клубом, ровно как
 * при регистрации по passkey: аккаунт без клуба показывать нечего.
 *
 * Имя приходится подбирать: в Яндексе оно какое угодно, а `users.username_key`
 * уникален. Занятость проверяется вставкой, а не запросом перед ней — между
 * запросом и вставкой имя всё равно может занять кто-то другой.
 */
async function createUserFor(identity: YandexIdentity): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    // «Артём», «Артём 2», «Артём 3» — тёзке видно, что имя занято, и он может
    // ни о чём не догадываться: оно его собственное, просто с номером.
    const username =
      attempt === 1 ? identity.name : `${identity.name.slice(0, NAME_MAX - 4).trim()} ${attempt}`;

    try {
      const user = await prisma.user.create({
        data: {
          username,
          usernameKey: normalizeKey(username),
          displayName: username,
          oauthAccounts: {
            create: {
              provider: 'yandex',
              providerAccountId: identity.subject,
              login: identity.login,
              email: identity.email,
            },
          },
        },
        select: { id: true, displayName: true },
      });

      await createClub(user.id, {
        name: `Клуб ${user.displayName}`.slice(0, CLUB_NAME_MAX),
        icon: '🎾',
        color: 'lime',
        playerName: user.displayName.slice(0, NAME_MAX),
      });

      return user.id;
    } catch (error) {
      // Тёзка. Пробуем следующий номер — но не бесконечно: сотня занятых
      // подряд означает не тёзок, а что-то сломанное.
      if (uniqueViolationOn(error, 'username_key') && attempt < 100) continue;

      // Гонка двух вкладок одного человека: связь с этим Яндексом успела
      // появиться, пока мы её заводили. Победила первая вставка, и она же
      // назовёт аккаунт — второй попытке остаётся им воспользоваться.
      if (uniqueViolationOn(error, 'provider_account_id')) {
        const existing = await findAccount(identity.subject);
        if (existing) return existing.userId;
      }

      throw error;
    }
  }
}

/**
 * Вход: находит аккаунт по id Яндекса или заводит новый.
 *
 * Слияния с существующим аккаунтом по почте нет намеренно. Почты у аккаунтов
 * с passkey не бывает вовсе — сливать не с чем, — а доверять чужому адресу
 * как доказательству «это тот же человек» значит отдавать аккаунт всякому,
 * кто заведёт себе такой же ящик. Связать входы можно только изнутри: войдя
 * своим passkey и нажав «привязать».
 */
export async function signInWithYandex(identity: YandexIdentity): Promise<string> {
  const existing = await findAccount(identity.subject);
  if (existing) {
    await touchAccount(identity);
    return existing.userId;
  }

  return createUserFor(identity);
}

/**
 * Чем кончилась привязка. Совпадает с кодами из lib/yandex.ts: результат
 * уезжает в адресную строку, а текст к нему подбирает экран.
 */
export type LinkResult = 'linked' | 'taken' | 'occupied';

export async function linkYandex(userId: string, identity: YandexIdentity): Promise<LinkResult> {
  const existing = await findAccount(identity.subject);
  if (existing) {
    // Свой же Яндекс, привязанный ранее: повтор ничего не меняет и ошибкой не
    // является — человек видит ровно то, чего добивался.
    if (existing.userId !== userId) return 'taken';
    await touchAccount(identity);
    return 'linked';
  }

  try {
    await prisma.oauthAccount.create({
      data: {
        provider: 'yandex',
        providerAccountId: identity.subject,
        userId,
        login: identity.login,
        email: identity.email,
      },
    });
    return 'linked';
  } catch (error) {
    // К аккаунту уже привязан другой Яндекс. Молча заменить нельзя: это
    // сменило бы человеку способ входа без его ведома.
    if (uniqueViolationOn(error, 'user_id')) return 'occupied';
    if (uniqueViolationOn(error, 'provider_account_id')) return 'taken';
    throw error;
  }
}

export interface LinkedYandex {
  login: string | null;
  email: string | null;
  /** Можно ли отвязать: passkey — единственный оставшийся способ войти. */
  removable: boolean;
}

/** Что привязано к аккаунту — для экрана профиля. */
export async function linkedYandex(userId: string): Promise<LinkedYandex | null> {
  const [account, passkeys] = await Promise.all([
    prisma.oauthAccount.findUnique({
      where: { userId_provider: { userId, provider: 'yandex' } },
      select: { login: true, email: true },
    }),
    prisma.credential.count({ where: { userId } }),
  ]);

  if (!account) return null;
  return { login: account.login, email: account.email, removable: passkeys > 0 };
}

/**
 * Отвязка. Запрещена, пока Яндекс — единственный вход: аккаунт, в который
 * нельзя войти, ничем не лучше удалённого, а удаление аккаунта — отдельное
 * решение, которого человек в этот момент не принимал.
 */
export async function unlinkYandex(userId: string): Promise<boolean> {
  const { count } = await prisma.oauthAccount.deleteMany({
    where: {
      userId,
      provider: 'yandex',
      // Условие проверяет база в том же запросе, которым удаляет: между
      // отдельным подсчётом passkey и удалением их можно успеть снести, и
      // тогда аккаунт остался бы вообще без входа.
      user: { credentials: { some: {} } },
    },
  });

  if (count > 0) return true;

  // Ничего не удалилось: либо отвязывать нечего — и тогда всё уже так, как
  // человек хотел, — либо passkey нет, и отвязка оставила бы его снаружи.
  const linked = await prisma.oauthAccount.count({ where: { userId, provider: 'yandex' } });
  return linked === 0;
}
