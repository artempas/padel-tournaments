import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureMessage } from '../src/lib/request.ts';

test('a dead connection is named as such, not as a server refusal', () => {
  // Именно так `fetch` сообщает, что до сервера не дошли.
  const message = failureMessage(new TypeError('Failed to fetch'), 'Не вышло', 'Нет сети');
  assert.equal(message, 'Нет сети');
});

test('the server explains its own refusals', () => {
  const message = failureMessage(new Error('Сумма очков не сходится'), 'Не вышло');
  assert.equal(message, 'Сумма очков не сходится');
});

test('a silent failure falls back to the caller wording', () => {
  assert.equal(failureMessage(new Error(''), 'Не вышло'), 'Не вышло');
  assert.equal(failureMessage('строка вместо ошибки', 'Не вышло'), 'Не вышло');
});
