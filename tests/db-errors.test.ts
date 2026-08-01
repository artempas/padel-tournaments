import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueViolationOn } from '../src/lib/db-errors.ts';

/**
 * Формы ошибок сняты с живого Prisma 7 через driver adapter — того самого, что
 * стоит в lib/prisma.ts. Смысл теста именно в них: разбор опирается на внешний
 * формат, который меняется не нашими руками.
 */
function violation(constraint: string, fields: string[]) {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: {
      modelName: 'User',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
          kind: 'UniqueConstraintViolation',
          constraint: { fields },
        },
      },
    },
  });
}

const NAME_TAKEN = violation('users_username_key_key', ['username_key']);
const SAME_YANDEX = violation('oauth_accounts_pkey', ['provider', 'provider_account_id']);
const SECOND_YANDEX = violation('oauth_accounts_user_id_provider_key', ['user_id', 'provider']);

test('виновная колонка узнаётся через driver adapter', () => {
  assert.equal(uniqueViolationOn(NAME_TAKEN, 'username_key'), true);
  assert.equal(uniqueViolationOn(SAME_YANDEX, 'provider_account_id'), true);
  assert.equal(uniqueViolationOn(SECOND_YANDEX, 'user_id'), true);
});

test('чужие ограничения не путаются между собой', () => {
  // Ровно то, на чём держится разбор в linkYandex: «этот Яндекс уже у другого»
  // и «у этого аккаунта уже есть Яндекс» — разные ответы человеку.
  assert.equal(uniqueViolationOn(SAME_YANDEX, 'user_id'), false);
  assert.equal(uniqueViolationOn(SECOND_YANDEX, 'provider_account_id'), false);
  assert.equal(uniqueViolationOn(NAME_TAKEN, 'user_id'), false);
});

test('понимается и форма с meta.target — на случай смены движка', () => {
  const legacy = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['username_key'] },
  });
  assert.equal(uniqueViolationOn(legacy, 'username_key'), true);
  assert.equal(uniqueViolationOn(legacy, 'user_id'), false);
});

test('не всякая ошибка — нарушение уникальности', () => {
  assert.equal(uniqueViolationOn(new Error('boom'), 'username_key'), false);
  assert.equal(uniqueViolationOn({ code: 'P2025' }, 'username_key'), false);
  assert.equal(uniqueViolationOn(null, 'username_key'), false);
  assert.equal(uniqueViolationOn(undefined, 'username_key'), false);
  // P2002 без подробностей: колонку назвать нельзя, значит и совпадения нет.
  assert.equal(uniqueViolationOn({ code: 'P2002' }, 'username_key'), false);
});
