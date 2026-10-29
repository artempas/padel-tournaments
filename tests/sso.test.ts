import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeUrl,
  decodeIdToken,
  identityFrom,
  ssoAccountName,
  ssoNotice,
  verifyIdToken,
  type SsoClaims,
} from '../src/lib/sso.ts';

const CONFIG = {
  issuer: 'https://auth.example.com/application/o/padel/',
  clientId: 'padel-client',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3000/api/auth/sso/callback',
  name: 'authentik',
};

const DISCOVERY = {
  issuer: 'https://auth.example.com/application/o/padel/',
  authorization_endpoint: 'https://auth.example.com/application/o/authorize/',
  token_endpoint: 'https://auth.example.com/application/o/token/',
  userinfo_endpoint: 'https://auth.example.com/application/o/userinfo/',
};

const NOW = 1_800_000_000;

function claims(overrides: Partial<SsoClaims> = {}): SsoClaims {
  return {
    iss: DISCOVERY.issuer,
    aud: CONFIG.clientId,
    exp: NOW + 300,
    nonce: 'n-1',
    sub: 'hashed-user-id',
    ...overrides,
  };
}

const expected = { issuer: DISCOVERY.issuer, clientId: CONFIG.clientId, nonce: 'n-1', now: NOW };

test('адрес входа: code + PKCE + nonce, scope с профилем и почтой', () => {
  const url = new URL(
    authorizeUrl(CONFIG, DISCOVERY, { state: 's', nonce: 'n', codeChallenge: 'c' }),
  );

  assert.equal(url.origin + url.pathname, DISCOVERY.authorization_endpoint);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CONFIG.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('state'), 's');
  assert.equal(url.searchParams.get('nonce'), 'n');
  assert.equal(url.searchParams.get('code_challenge'), 'c');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('id_token разбирается из JWT', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'x', name: 'Артём' })).toString('base64url');
  assert.deepEqual(decodeIdToken(`header.${payload}.signature`), { sub: 'x', name: 'Артём' });
  assert.throws(() => decodeIdToken('not-a-jwt'));
});

test('годный id_token отдаёт sub', () => {
  assert.equal(verifyIdToken(claims(), expected), 'hashed-user-id');
  assert.equal(verifyIdToken(claims({ aud: [CONFIG.clientId] }), expected), 'hashed-user-id');
  // Минута на расхождение часов.
  assert.equal(verifyIdToken(claims({ exp: NOW - 30 }), expected), 'hashed-user-id');
});

test('чужой, просроченный или не тот id_token не принимается', () => {
  assert.throws(() => verifyIdToken(claims({ iss: 'https://evil.example.com/' }), expected), /issuer/);
  assert.throws(() => verifyIdToken(claims({ aud: 'other-client' }), expected), /audience/);
  assert.throws(
    () => verifyIdToken(claims({ aud: [CONFIG.clientId, 'other'], azp: 'other' }), expected),
    /authorized party/,
  );
  assert.throws(() => verifyIdToken(claims({ exp: NOW - 120 }), expected), /expired/);
  assert.throws(() => verifyIdToken(claims({ exp: undefined }), expected), /expired/);
  assert.throws(() => verifyIdToken(claims({ nonce: 'n-2' }), expected), /nonce/);
  assert.throws(() => verifyIdToken(claims({ nonce: undefined }), expected), /nonce/);
  assert.throws(() => verifyIdToken(claims({ sub: '  ' }), expected), /sub/);
});

test('имя: от того, как человека зовут, к логину; пустым не бывает', () => {
  assert.equal(ssoAccountName({ name: 'Артём Петров', preferred_username: 'artem' }), 'Артём Петров');
  assert.equal(ssoAccountName({ given_name: 'Артём', family_name: 'Петров' }), 'Артём Петров');
  assert.equal(ssoAccountName({ preferred_username: 'artem' }), 'artem');
  assert.equal(ssoAccountName({ nickname: 'tema' }), 'tema');
  assert.equal(ssoAccountName({ name: '   ' }), 'Игрок');
  assert.equal(ssoAccountName({}), 'Игрок');
  assert.equal(ssoAccountName({ name: 'я'.repeat(60) }).length, 40);
});

test('человек из SSO: подсказкой — имя, без имени — логин', () => {
  assert.deepEqual(
    identityFrom('sub-1', { name: 'Артём', preferred_username: 'artem', email: ' a@example.com ' }),
    { subject: 'sub-1', login: 'Артём', email: 'a@example.com', name: 'Артём' },
  );
  assert.deepEqual(identityFrom('sub-2', { preferred_username: 'artem' }), {
    subject: 'sub-2',
    login: 'artem',
    email: null,
    name: 'artem',
  });
  assert.equal(identityFrom('sub-3', {}).login, '');
});

test('сообщения подставляют имя провайдера; незнакомый код — молчание', () => {
  assert.equal(ssoNotice('denied', 'authentik'), 'Вход через authentik отменён.');
  assert.equal(ssoNotice('linked', 'authentik'), 'authentik привязан.');
  assert.equal(ssoNotice('nope', 'authentik'), null);
  assert.equal(ssoNotice(null, 'authentik'), null);
  assert.equal(ssoNotice('toString', 'authentik'), null);
});
