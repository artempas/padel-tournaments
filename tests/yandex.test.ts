import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAME_MAX,
  accountName,
  authorizeUrl,
  identityFrom,
  resolveOrigin,
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

test('при нынешних правах приходит только id и логин — им и называется аккаунт', () => {
  // Ровно то, что Яндекс отдаёт без единого права. Ни имени, ни почты.
  assert.deepEqual(identityFrom({ id: '1234567', login: 'tema' }), {
    subject: '1234567',
    login: 'tema',
    email: null,
    name: 'tema',
  });
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

test('resolveOrigin берёт публичный дом из заголовков прокси', () => {
  const headers = new Headers({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'padel.example.com',
  });

  assert.equal(resolveOrigin(headers, 'http://0.0.0.0:3000'), 'https://padel.example.com');
});

test('resolveOrigin не приклеивает порт второй раз', () => {
  // Прокси часто кладёт порт и в host, и отдельным заголовком. Склеенные
  // вместе, они дают `host:3000:3000` — URL, который не разбирается вовсе.
  const both = new Headers({
    'x-forwarded-proto': 'http',
    'x-forwarded-host': 'localhost:3000',
    'x-forwarded-port': '3000',
  });
  assert.equal(resolveOrigin(both, 'http://localhost:3000'), 'http://localhost:3000');
  assert.doesNotThrow(() => new URL('/', resolveOrigin(both, 'http://localhost:3000')));

  // Порт отдельно от хоста — единственный случай, когда его нужно добавить.
  const split = new Headers({
    'x-forwarded-proto': 'http',
    'x-forwarded-host': 'localhost',
    'x-forwarded-port': '3000',
  });
  assert.equal(resolveOrigin(split, 'http://0.0.0.0:3000'), 'http://localhost:3000');
});

test('resolveOrigin молчит о порте по умолчанию', () => {
  // С `:443` адрес перестал бы совпадать с ORIGIN, обозначая то же место.
  const https = new Headers({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'padel.example.com',
    'x-forwarded-port': '443',
  });
  assert.equal(resolveOrigin(https, 'http://0.0.0.0:3000'), 'https://padel.example.com');

  const http = new Headers({
    'x-forwarded-proto': 'http',
    'x-forwarded-host': 'padel.example.com',
    'x-forwarded-port': '80',
  });
  assert.equal(resolveOrigin(http, 'http://0.0.0.0:3000'), 'http://padel.example.com');
});

test('resolveOrigin без заголовков прокси отдаёт адрес как есть', () => {
  assert.equal(resolveOrigin(new Headers(), 'http://localhost:3000'), 'http://localhost:3000');
  assert.equal(resolveOrigin(undefined, 'http://localhost:3000'), 'http://localhost:3000');
  // Одного заголовка мало: схема без хоста и хост без схемы ничего не задают.
  const half = new Headers({ 'x-forwarded-host': 'padel.example.com' });
  assert.equal(resolveOrigin(half, 'http://localhost:3000'), 'http://localhost:3000');
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
  // Прав не запрашивается никаких: приложению хватает id и логина, которые
  // Яндекс отдаёт и без них. Набор прав задан в кабинете, а не в коде.
  assert.equal(url.searchParams.get('scope'), null);
});

test('неизвестный код в адресе — молчание, а не выдуманный текст', () => {
  assert.equal(yandexNotice('denied'), 'Вход через Яндекс отменён.');
  assert.equal(yandexNotice('linked'), 'Яндекс ID привязан.');
  assert.equal(yandexNotice(null), null);
  assert.equal(yandexNotice('что-угодно'), null);
});
