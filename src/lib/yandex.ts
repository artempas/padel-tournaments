/**
 * Яндекс ID: сторона протокола.
 *
 * Здесь только разговор с Яндексом — адрес экрана согласия, обмен кода на
 * токен и чтение профиля. Ни сессий, ни базы: что делать с полученным
 * человеком, решает lib/oauth.ts, а этот модуль ничего не знает о том, есть ли
 * у нас вообще пользователи.
 *
 * Токен Яндекса живёт ровно столько, сколько длится обработка коллбэка: профиль
 * читается один раз, и наружу уходит уже своя сессия. Поэтому ни access-, ни
 * refresh-токен нигде не сохраняются — хранить нечего, а значит и утекать
 * нечему. Понадобятся запросы к API Яндекса от имени человека — придётся
 * заводить хранилище токенов, сейчас его нет намеренно.
 */

const AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const TOKEN_URL = 'https://oauth.yandex.ru/token';
const INFO_URL = 'https://login.yandex.ru/info?format=json';

/**
 * Права, которые запрашиваются на экране согласия.
 *
 * Портрета здесь нет: аватаров в приложении не бывает — игрок это имя в
 * ростере, — а лишняя строка на экране согласия стоит доверия и конверсии.
 * Почта нужна, чтобы человек по ней узнал привязанный аккаунт в своём профиле.
 */
const SCOPE = 'login:info login:email';

/** Путь коллбэка. Должен совпадать с Redirect URI в настройках приложения. */
export const CALLBACK_PATH = '/api/auth/yandex/callback';

export interface YandexConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Настройки или `null`, если вход через Яндекс не подключён.
 *
 * Не исключение: без ключей приложение обязано работать как раньше, просто без
 * кнопки. Экран входа спрашивает ровно этим — есть настройки, есть кнопка.
 */
export function yandexConfig(): YandexConfig | null {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret, redirectUri: redirectUri() };
}

/**
 * Redirect URI. По умолчанию собирается из `ORIGIN` — того самого адреса,
 * который приложение и так обязано знать точно ради passkey. Отдельная
 * переменная нужна редко: когда `ORIGIN` перечисляет несколько адресов и
 * зарегистрирован в Яндексе не первый из них.
 */
function redirectUri(): string {
  const explicit = process.env.YANDEX_REDIRECT_URI;
  if (explicit) return explicit;

  const origin = process.env.ORIGIN?.split(',')[0]?.trim();
  if (!origin) throw new Error('ORIGIN must be set — see .env.example');

  return `${origin.replace(/\/+$/, '')}${CALLBACK_PATH}`;
}

/** Адрес экрана согласия Яндекса. */
export function authorizeUrl(
  config: YandexConfig,
  params: { state: string; codeChallenge: string },
): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPE,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${AUTHORIZE_URL}?${query.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Обмен кода на токен.
 *
 * Отправляется и секрет приложения, и PKCE-верификатор. Яндекс не требует
 * секрета при PKCE, но приложение серверное: секрет доказывает, что за кодом
 * пришли мы, верификатор — что пришли с того же устройства, с которого код
 * запрашивали. Одно другого не заменяет.
 */
export async function exchangeCode(
  config: YandexConfig,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
    cache: 'no-store',
  });

  const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    // Самая частая причина — код старше десяти минут (invalid_grant) или
    // повторный обмен того же кода. Текст от Яндекса нужен в логе, наружу он
    // не идёт: человеку он ничего не объясняет.
    throw new Error(
      `yandex token exchange failed: ${data.error ?? response.status} ${data.error_description ?? ''}`.trim(),
    );
  }

  return data.access_token;
}

/** Ответ login.yandex.ru — только те поля, которые даёт запрошенный scope. */
export interface YandexUserInfo {
  id?: string;
  login?: string;
  default_email?: string;
  emails?: string[];
  first_name?: string;
  last_name?: string;
  display_name?: string;
  real_name?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<YandexUserInfo> {
  const response = await fetch(INFO_URL, {
    headers: { authorization: `OAuth ${accessToken}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`yandex userinfo failed: ${response.status}`);
  }

  return (await response.json()) as YandexUserInfo;
}

/**
 * Человек из Яндекса в том виде, в каком он нужен приложению.
 *
 * `subject` — это `id` Яндекса, и именно он связывает аккаунты. Ни логин, ни
 * почта на эту роль не годятся: их меняют, а id закреплён навсегда.
 */
export interface YandexIdentity {
  subject: string;
  login: string;
  email: string | null;
  /** Имя, под которым человек появится в приложении. */
  name: string;
}

/** Имя длиннее не бывает: столько же отведено игроку в ростере. */
export const NAME_MAX = 40;

export function identityFrom(info: YandexUserInfo): YandexIdentity {
  const subject = String(info.id ?? '').trim();
  if (!subject) throw new Error('yandex userinfo has no id');

  const login = String(info.login ?? '').trim();

  return {
    subject,
    login,
    email: info.default_email?.trim() || info.emails?.[0]?.trim() || null,
    name: accountName(info),
  };
}

/**
 * Имя аккаунта из профиля Яндекса.
 *
 * Порядок предпочтений — от того, как человек сам себя называет, к тому, чем
 * его называет система: `display_name` он задаёт сам, имя с фамилией приходят
 * из паспорта аккаунта, логин остаётся на случай, когда не отдано ничего.
 * Пустым результат не бывает: имя видно в турнирной таблице, и «» там хуже
 * любой замены.
 */
export function accountName(info: YandexUserInfo): string {
  const candidates = [
    info.display_name,
    [info.first_name, info.last_name].filter(Boolean).join(' '),
    info.real_name,
    info.login,
  ];

  for (const candidate of candidates) {
    const name = String(candidate ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, NAME_MAX)
      .trim();
    if (name) return name;
  }

  return 'Игрок';
}

/**
 * Куда вернуть человека после входа.
 *
 * Адрес приходит из ссылки («войдите, чтобы принять приглашение»), поэтому
 * пропускается только путь внутри приложения. `//` отсеивается отдельно: это
 * ссылка на чужой хост, которую браузер понимает как внешнюю.
 */
export function safeNext(value: string | null | undefined, fallback = '/tournaments'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}

/**
 * Чем кончился поход к Яндексу. Одно слово в адресной строке — один текст на
 * экране; коды не пересекаются, поэтому и экран входа, и профиль читают их
 * одним и тем же способом.
 */
export const YANDEX_NOTICES = {
  denied: 'Вход через Яндекс отменён.',
  failed: 'Не удалось войти через Яндекс ID. Попробуйте ещё раз.',
  expired: 'Вход через Яндекс занял слишком много времени. Попробуйте ещё раз.',
  off: 'Вход через Яндекс ID сейчас недоступен.',
  session: 'Пока вы были на Яндексе, вход в приложение истёк. Войдите и повторите привязку.',
  linked: 'Яндекс ID привязан.',
  taken: 'Этот Яндекс ID уже привязан к другому аккаунту.',
  occupied: 'К аккаунту уже привязан другой Яндекс ID — сначала отвяжите его.',
  unlinked: 'Яндекс ID отвязан.',
} as const;

export type YandexNotice = keyof typeof YANDEX_NOTICES;

/** Текст по коду из адреса. Неизвестный код — не текст, а молчание. */
export function yandexNotice(code: string | null | undefined): string | null {
  if (!code) return null;
  return YANDEX_NOTICES[code as YandexNotice] ?? null;
}
