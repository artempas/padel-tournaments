import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { ApiError } from './api';
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
 * Вход знакомым Яндексом. `null` значит, что такого мы не знаем — это не
 * ошибка, а новый человек, и дальше его ждёт выбор имени.
 *
 * Слияния с существующим аккаунтом по почте нет намеренно. Почты приложение
 * теперь и не видит, а доверять чужому адресу как доказательству «это тот же
 * человек» значило бы отдавать аккаунт всякому, кто заведёт себе такой же
 * ящик. Связать входы можно только изнутри: войдя своим passkey и нажав
 * «привязать».
 */
export async function signInWithYandex(identity: YandexIdentity): Promise<string | null> {
  const existing = await findAccount(identity.subject);
  if (!existing) return null;

  await touchAccount(identity);
  return existing.userId;
}

/**
 * Регистрация, отложенная до выбора имени.
 *
 * Между «Яндекс подтвердил, кто это» и «аккаунт создан» появляется разговор:
 * человек называет себя сам, а не получает в турнирную таблицу свой логин.
 * До конца разговора аккаунта не существует — бросил на полпути, и не осталось
 * ничего.
 */
const SIGNUP_COOKIE = 'padel_signup';
const SIGNUP_TTL_MS = 15 * 60_000;

export async function beginSignup(identity: YandexIdentity, next: string): Promise<void> {
  const row = await prisma.oauthSignup.create({
    data: {
      provider: 'yandex',
      providerAccountId: identity.subject,
      login: identity.login,
      email: identity.email,
      next: safeNext(next),
      expiresAt: new Date(Date.now() + SIGNUP_TTL_MS),
    },
    select: { id: true },
  });

  const store = await cookies();
  store.set(SIGNUP_COOKIE, row.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SIGNUP_TTL_MS / 1000,
  });
}

export interface PendingSignup {
  /** Логин у провайдера — им подсказывается имя, если своё не придумалось. */
  suggestion: string;
  next: string;
}

/** Читает начатую регистрацию, не тратя её: экрану нужно лишь показать форму. */
export async function peekSignup(): Promise<PendingSignup | null> {
  const store = await cookies();
  const id = store.get(SIGNUP_COOKIE)?.value;
  if (!id) return null;

  // Кривой id — не исключение, а просто отсутствие регистрации: на нечитаемый
  // uuid Postgres отвечает ошибкой типа, и она здесь означает ровно «нет».
  const row = await prisma.oauthSignup
    .findFirst({
      where: { id, expiresAt: { gt: new Date() } },
      select: { login: true, next: true },
    })
    .catch(() => null);
  if (!row) return null;

  return { suggestion: (row.login ?? '').slice(0, NAME_MAX), next: safeNext(row.next) };
}

/** Регистрация отыграна: строка больше не нужна, кука тем более. */
async function discardSignup(
  id: string,
  store: Awaited<ReturnType<typeof cookies>>,
): Promise<void> {
  store.delete(SIGNUP_COOKIE);
  await prisma.oauthSignup.deleteMany({ where: { id } }).catch(() => {});
}

/**
 * Проверка имени. Та же, что при регистрации по passkey: слишком короткое имя
 * ничего не говорит о человеке ни в ростере, ни в списке участников.
 */
const NAME_MIN = 2;

function validateName(input: unknown): string {
  const name = String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ApiError(`Имя от ${NAME_MIN} до ${NAME_MAX} символов`);
  }
  return name;
}

/**
 * Завершение регистрации: аккаунт с выбранным именем и личный клуб — ровно
 * как при регистрации по passkey, аккаунт без клуба показывать нечего.
 *
 * Кто регистрируется, берётся из базы, а не из запроса: клиент присылает одно
 * лишь имя.
 *
 * Начатая регистрация не тратится на неудачную попытку — иначе «такое имя уже
 * занято» означало бы «идите на Яндекс заново», хотя человеку достаточно
 * придумать другое имя. Единственность аккаунта держится не на этом, а на
 * уникальности связи с Яндексом: второй раз тем же `id` аккаунт не завести,
 * сколько бы вкладок ни пыталось разом.
 */
export async function completeSignup(name: unknown): Promise<{ userId: string; next: string }> {
  const username = validateName(name);

  const store = await cookies();
  const id = store.get(SIGNUP_COOKIE)?.value;

  const pending = id
    ? await prisma.oauthSignup
        .findFirst({
          where: { id, expiresAt: { gt: new Date() } },
          select: { providerAccountId: true, login: true, email: true, next: true },
        })
        .catch(() => null)
    : null;

  if (!id || !pending) {
    store.delete(SIGNUP_COOKIE);
    throw new ApiError('Регистрация истекла — войдите через Яндекс ещё раз', 408);
  }

  let user: { id: string; displayName: string };
  try {
    user = await prisma.user.create({
      data: {
        username,
        usernameKey: normalizeKey(username),
        displayName: username,
        oauthAccounts: {
          create: {
            provider: 'yandex',
            providerAccountId: pending.providerAccountId,
            login: pending.login,
            email: pending.email,
          },
        },
      },
      select: { id: true, displayName: true },
    });
  } catch (error) {
    // Имя выбрал человек, и занятое имя — его дело, а не повод придумывать за
    // него замену с номером. Так же отвечает и регистрация по passkey. Форма
    // остаётся на экране, начатая регистрация — в базе.
    if (uniqueViolationOn(error, 'username_key')) {
      throw new ApiError('Такое имя уже занято', 409);
    }

    // Тем временем этот же Яндекс успел завести аккаунт в другой вкладке.
    // Регистрировать нечего, и держать начатую больше незачем.
    if (uniqueViolationOn(error, 'provider_account_id')) {
      await discardSignup(id, store);
      throw new ApiError('Этот Яндекс ID уже зарегистрирован — войдите им', 409);
    }

    throw error;
  }

  await createClub(user.id, {
    name: `Клуб ${user.displayName}`.slice(0, CLUB_NAME_MAX),
    icon: '🎾',
    color: 'lime',
    playerName: user.displayName.slice(0, NAME_MAX),
  });

  await discardSignup(id, store);

  return { userId: user.id, next: safeNext(pending.next) };
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
