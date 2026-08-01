import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAME_MAX,
  accountName,
  authorizeUrl,
  identityFrom,
  safeNext,
  yandexNotice,
} from '../src/lib/yandex.ts';

const CONFIG = {
  clientId: 'abc123',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3000/api/auth/yandex/callback',
};

test('имя аккаунта берётся от того, как человек назвал себя сам', () => {
  assert.equal(
    accountName({ display_name: 'Артём', first_name: 'Артемий', last_name: 'П', login: 'tema' }),
    'Артём',
  );
  assert.equal(accountName({ first_name: 'Артемий', last_name: 'Петров', login: 'tema' }), 'Артемий Петров');
  assert.equal(accountName({ last_name: 'Петров' }), 'Петров');
  assert.equal(accountName({ real_name: 'Артемий Петров' }), 'Артемий Петров');
  assert.equal(accountName({ login: 'tema' }), 'tema');
});

test('пустого имени не бывает: его видно в турнирной таблице', () => {
  assert.equal(accountName({}), 'Игрок');
  assert.equal(accountName({ display_name: '   ', login: '' }), 'Игрок');
  // Пробелы вместо имени и фамилии не должны превратиться в имя из пробела.
  assert.equal(accountName({ first_name: ' ', last_name: ' ' }), 'Игрок');
});

test('имя причёсывается: без краёв, без двойных пробелов, не длиннее игрока', () => {
  assert.equal(accountName({ display_name: '  Артём   Петров  ' }), 'Артём Петров');

  const long = accountName({ display_name: 'я'.repeat(NAME_MAX + 10) });
  assert.equal(long.length, NAME_MAX);
});

test('identityFrom: id обязателен, почта берётся из любого доступного поля', () => {
  const identity = identityFrom({
    id: '1234567',
    login: 'tema',
    default_email: 'tema@yandex.ru',
    display_name: 'Артём',
  });
  assert.deepEqual(identity, {
    subject: '1234567',
    login: 'tema',
    email: 'tema@yandex.ru',
    name: 'Артём',
  });

  assert.equal(identityFrom({ id: '1', login: 'x', emails: ['a@ya.ru'] }).email, 'a@ya.ru');
  assert.equal(identityFrom({ id: '1', login: 'x' }).email, null);
  // Без id связывать аккаунты не с чем — это сломанный ответ, а не гость.
  assert.throws(() => identityFrom({ login: 'x' }));
});

test('safeNext пропускает только путь внутри приложения', () => {
  assert.equal(safeNext('/join/abc'), '/join/abc');
  assert.equal(safeNext('/club/me?tab=1'), '/club/me?tab=1');

  assert.equal(safeNext(null), '/tournaments');
  assert.equal(safeNext(''), '/tournaments');
  assert.equal(safeNext('https://evil.example'), '/tournaments');
  // Ссылка на чужой хост, которую браузер понимает как внешнюю.
  assert.equal(safeNext('//evil.example'), '/tournaments');
  assert.equal(safeNext('/\\evil.example'), '/tournaments');
  assert.equal(safeNext('tournaments'), '/tournaments');
});

test('адрес экрана согласия несёт PKCE и state', () => {
  const url = new URL(
    authorizeUrl(CONFIG, { state: 'st-1', codeChallenge: 'ch-1' }),
  );

  assert.equal(url.origin + url.pathname, 'https://oauth.yandex.ru/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CONFIG.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(url.searchParams.get('state'), 'st-1');
  assert.equal(url.searchParams.get('code_challenge'), 'ch-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  // Секрет приложения на экране согласия не участвует.
  assert.equal(url.searchParams.get('client_secret'), null);
  // Портрет не запрашивается: аватаров в приложении нет.
  assert.equal(url.searchParams.get('scope'), 'login:info login:email');
});

test('неизвестный код в адресе — молчание, а не выдуманный текст', () => {
  assert.equal(yandexNotice('denied'), 'Вход через Яндекс отменён.');
  assert.equal(yandexNotice('linked'), 'Яндекс ID привязан.');
  assert.equal(yandexNotice(null), null);
  assert.equal(yandexNotice('что-угодно'), null);
});
