/**
 * Собственный SSO: сторона протокола OpenID Connect.
 *
 * Писалось под authentik, но ничего специфичного для него здесь нет — это
 * обычный Authorization Code Flow с PKCE, и подойдёт любой OIDC-сервер
 * (Keycloak, Authelia, Zitadel). Всё, что нужно знать о сервере, приложение
 * узнаёт из его discovery-документа, поэтому в настройках только адрес
 * издателя, ключи клиента и имя для кнопки.
 *
 * Как и lib/yandex.ts, модуль ничего не знает о наших пользователях: он
 * отвечает на вопрос «кто это», а что с этим делать, решает lib/oauth.ts.
 * Токены сервера переживают только обработку коллбэка и нигде не хранятся.
 */

/** Путь коллбэка. Должен совпадать с Redirect URI в настройках провайдера. */
export const SSO_CALLBACK_PATH = '/api/auth/sso/callback';

/**
 * Что просим. `profile` и `email` — только ради подсказки имени и строки
 * «привязан …» в профиле: аккаунты связывает `sub`, а не почта.
 */
const SCOPE = 'openid profile email';

export interface SsoConfig {
  /** Издатель как он записан в discovery, например `https://auth.example.com/application/o/padel/`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Как называть провайдер на кнопке и в сообщениях. */
  name: string;
}

/**
 * Настройки или `null`, если SSO не подключён. Как и у Яндекса, не исключение:
 * без переменных приложение работает как раньше, только без кнопки.
 */
export function ssoConfig(): SsoConfig | null {
  const issuer = process.env.SSO_ISSUER?.trim();
  const clientId = process.env.SSO_CLIENT_ID?.trim();
  const clientSecret = process.env.SSO_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: callbackUri(process.env.SSO_REDIRECT_URI),
    name: process.env.SSO_NAME?.trim() || 'SSO',
  };
}

/**
 * Тот же расчёт, что у Яндекса: из первого `ORIGIN`, если адрес не задан явно.
 * Повторён, а не импортирован, чтобы модуль оставался без зависимостей и
 * запускался под `node --test` как есть.
 */
function callbackUri(explicit: string | undefined): string {
  if (explicit) return explicit;

  const origin = process.env.ORIGIN?.split(',')[0]?.trim();
  if (!origin) throw new Error('ORIGIN must be set — see .env.example');

  return `${origin.replace(/\/+$/, '')}${SSO_CALLBACK_PATH}`;
}

/** Издатели сравниваются без хвостового слэша: authentik пишет его, люди — как придётся. */
function sameIssuer(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

/**
 * Discovery-документ кешируется на время жизни процесса: адреса у сервера не
 * меняются, а лишний запрос на каждом входе — лишняя точка отказа. Неудача из
 * кеша выкидывается, чтобы недоступный в момент старта сервер не сломал вход
 * до перезапуска.
 */
const discoveries = new Map<string, Promise<Discovery>>();

export function discover(config: SsoConfig): Promise<Discovery> {
  const cached = discoveries.get(config.issuer);
  if (cached) return cached;

  const pending = loadDiscovery(config.issuer);
  discoveries.set(config.issuer, pending);
  pending.catch(() => discoveries.delete(config.issuer));
  return pending;
}

async function loadDiscovery(issuer: string): Promise<Discovery> {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`sso discovery failed: ${response.status} ${url}`);

  const data = (await response.json()) as Partial<Discovery>;
  if (!data.issuer || !data.authorization_endpoint || !data.token_endpoint) {
    throw new Error(`sso discovery is incomplete: ${url}`);
  }

  // Документ обязан описывать того самого издателя, которого мы спросили.
  // Расхождение почти всегда значит опечатку в SSO_ISSUER — например, адрес
  // без слага приложения в authentik, — и лучше упасть здесь, с понятным
  // текстом в логе, чем на проверке id_token.
  if (!sameIssuer(data.issuer, issuer)) {
    throw new Error(`sso issuer mismatch: configured ${issuer}, discovery says ${data.issuer}`);
  }

  return data as Discovery;
}

export function authorizeUrl(
  config: SsoConfig,
  discovery: Discovery,
  params: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPE,
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();

  return url.toString();
}

export interface Tokens {
  accessToken: string;
  idToken: string;
}

/**
 * Обмен кода на токены. Как и с Яндексом, идут и секрет клиента, и
 * PKCE-верификатор: одно доказывает, что за кодом пришёл наш сервер, другое —
 * что пришёл с того же браузера, который код запрашивал.
 */
export async function exchangeCode(
  config: SsoConfig,
  discovery: Discovery,
  code: string,
  codeVerifier: string,
): Promise<Tokens> {
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
    cache: 'no-store',
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token || !data.id_token) {
    throw new Error(
      `sso token exchange failed: ${data.error ?? response.status} ${data.error_description ?? ''}`.trim(),
    );
  }

  return { accessToken: data.access_token, idToken: data.id_token };
}

/**
 * Утверждения о человеке — из id_token и userinfo вперемешку. Все поля, кроме
 * служебных, необязательные: что из них придёт, решают scope-маппинги на
 * сервере.
 */
export interface SsoClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  nonce?: string;
  preferred_username?: string;
  nickname?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

export function decodeIdToken(idToken: string): SsoClaims {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('sso id_token is not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as SsoClaims;
}

/**
 * Проверка id_token без проверки подписи — и это не небрежность: токен пришёл
 * не из браузера, а напрямую от token endpoint по TLS, в ответ на наш секрет.
 * OpenID Connect Core (3.1.3.7, п. 6) прямо разрешает в таком случае
 * полагаться на TLS вместо подписи. Остальное проверяется: что токен выпущен
 * нашим издателем, для нашего клиента, ещё жив и относится именно к этому
 * входу — `nonce` из куки рукопожатия.
 */
export function verifyIdToken(
  claims: SsoClaims,
  expected: { issuer: string; clientId: string; nonce: string; now?: number },
): string {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (!claims.iss || claims.iss !== expected.issuer) throw new Error('sso id_token: wrong issuer');
  if (!audiences.includes(expected.clientId)) throw new Error('sso id_token: wrong audience');
  if (audiences.length > 1 && claims.azp !== expected.clientId) {
    throw new Error('sso id_token: wrong authorized party');
  }
  // Минута на расхождение часов между нашим сервером и сервером SSO.
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now) throw new Error('sso id_token: expired');
  if (!claims.nonce || claims.nonce !== expected.nonce) throw new Error('sso id_token: wrong nonce');

  const subject = String(claims.sub ?? '').trim();
  if (!subject) throw new Error('sso id_token has no sub');
  return subject;
}

/**
 * Профиль из userinfo. Если сервер его не объявил, хватит и id_token —
 * authentik по умолчанию кладёт туда те же утверждения.
 *
 * `sub` в ответе обязан совпасть с `sub` из id_token (Core 5.3.2): иначе это
 * профиль другого человека, и принимать его нельзя.
 */
export async function fetchClaims(
  discovery: Discovery,
  tokens: Tokens,
  subject: string,
  idClaims: SsoClaims,
): Promise<SsoClaims> {
  if (!discovery.userinfo_endpoint) return idClaims;

  const response = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`sso userinfo failed: ${response.status}`);

  const info = (await response.json()) as SsoClaims;
  if (info.sub !== subject) throw new Error('sso userinfo sub does not match id_token');

  return { ...idClaims, ...info };
}

/** Тот же облик, что и у человека из Яндекса: lib/oauth.ts их не различает. */
export interface SsoIdentity {
  subject: string;
  login: string;
  email: string | null;
  name: string;
}

/** Столько же отведено имени игрока в ростере (см. NAME_MAX в lib/yandex.ts). */
const NAME_MAX = 40;

function tidy(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX)
    .trim();
}

/**
 * Имя из профиля SSO. Порядок — от того, как человека зовут, к тому, как его
 * называет система. Пустым не бывает: имя видно в турнирной таблице.
 */
export function ssoAccountName(claims: SsoClaims): string {
  const candidates = [
    claims.name,
    [claims.given_name, claims.family_name].filter(Boolean).join(' '),
    claims.preferred_username,
    claims.nickname,
  ];

  for (const candidate of candidates) {
    const name = tidy(candidate);
    if (name) return name;
  }
  return 'Игрок';
}

/**
 * `login` здесь — подсказка на экране «Как вас зовут?», поэтому берётся то,
 * под чем человек известен в SSO: полное имя, если оно есть, а не служебный
 * логин. У Яндекса имени нет вовсе, и там подсказкой работает логин.
 */
export function identityFrom(subject: string, claims: SsoClaims): SsoIdentity {
  const name = ssoAccountName(claims);
  const username = tidy(claims.preferred_username) || tidy(claims.nickname);

  return {
    subject,
    login: name !== 'Игрок' ? name : username,
    email: claims.email?.trim() || null,
    name,
  };
}

/**
 * Чем кончился поход на SSO. Коды те же, что у Яндекса, — экран читает их
 * одинаково, — а тексты подставляют имя провайдера: человек знает свой
 * authentik под тем именем, которым его назвали в SSO_NAME.
 */
const SSO_NOTICES = {
  denied: (name: string) => `Вход через ${name} отменён.`,
  failed: (name: string) => `Не удалось войти через ${name}. Попробуйте ещё раз.`,
  expired: (name: string) => `Вход через ${name} занял слишком много времени. Попробуйте ещё раз.`,
  off: (name: string) => `Вход через ${name} сейчас недоступен.`,
  session: (name: string) =>
    `Пока вы входили в ${name}, вход в приложение истёк. Войдите и повторите привязку.`,
  linked: (name: string) => `${name} привязан.`,
  taken: (name: string) => `Этот аккаунт ${name} уже привязан к другому аккаунту.`,
  occupied: (name: string) => `К аккаунту уже привязан другой аккаунт ${name} — сначала отвяжите его.`,
  unlinked: (name: string) => `${name} отвязан.`,
} as const;

export function ssoNotice(code: string | null | undefined, name: string): string | null {
  // `hasOwn`: код приходит из адреса, и `?sso=toString` не должен найти
  // метод объекта вместо текста.
  if (!code || !Object.hasOwn(SSO_NOTICES, code)) return null;
  return SSO_NOTICES[code as keyof typeof SSO_NOTICES](name);
}
