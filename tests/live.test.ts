import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTopic,
  publish,
  publishTournament,
  subscribe,
  subscriberCount,
  tournamentTopic,
  type LiveFrame,
} from '../src/lib/live.ts';
import type { TournamentDetail } from '../src/lib/types.ts';

/**
 * Хаб живёт на globalThis и переживает тесты в одном процессе, поэтому каждый
 * случай берёт свою тему. Это дешевле экспортированного `resetHub()`: тестовой
 * поверхности в рабочем коде не появляется, и порядок тестов ни на что не
 * влияет.
 */
function topic(name: string): string {
  return `tournament:t-${name}`;
}

function frame(data = '{}'): LiveFrame {
  return { event: 'tournament', data };
}

function tournament(over: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: 't1',
    name: 'Пятничный американо',
    courts: 1,
    format: 'americano',
    roundsPlanned: null,
    pointsPerMatch: 16,
    status: 'running',
    closedEarly: false,
    createdAt: '2026-07-01T18:00:00.000Z',
    finishedAt: null,
    players: [],
    matches: [],
    ratingBefore: {},
    ...over,
  };
}

test('подписчик получает кадр своей темы', () => {
  const seen: LiveFrame[] = [];
  const t = topic('delivery');
  subscribe(t, (f) => seen.push(f));

  publish(t, frame('{"id":"t1"}'));

  assert.deepEqual(seen, [{ event: 'tournament', data: '{"id":"t1"}' }]);
});

test('кадр получают все подписчики темы и никто из чужой', () => {
  const mine: LiveFrame[] = [];
  const also: LiveFrame[] = [];
  const other: LiveFrame[] = [];
  const t = topic('fanout');

  subscribe(t, (f) => mine.push(f));
  subscribe(t, (f) => also.push(f));
  subscribe(topic('fanout-other'), (f) => other.push(f));

  publish(t, frame());

  assert.equal(mine.length, 1);
  assert.equal(also.length, 1);
  assert.equal(other.length, 0);
});

test('отписка прекращает доставку и не оставляет следов', () => {
  const seen: LiveFrame[] = [];
  const t = topic('unsubscribe');
  const off = subscribe(t, (f) => seen.push(f));

  off();
  publish(t, frame());

  assert.equal(seen.length, 0);
  assert.equal(subscriberCount(t), 0);
  // Пустая тема не остаётся в карте: иначе за месяц аптайма их накопится по
  // одной на каждый когда-либо открытый турнир.
  assert.equal(hasTopic(t), false);
});

test('повторная отписка безопасна и не трогает соседа', () => {
  const seen: LiveFrame[] = [];
  const t = topic('idempotent');
  const off = subscribe(t, () => {});
  subscribe(t, (f) => seen.push(f));

  off();
  off();
  publish(t, frame());

  assert.equal(seen.length, 1);
  assert.equal(subscriberCount(t), 1);
});

test('упавший подписчик уходит и не мешает остальным', () => {
  const seen: LiveFrame[] = [];
  const t = topic('throwing');
  subscribe(t, () => {
    throw new Error('соединение закрыто');
  });
  subscribe(t, (f) => seen.push(f));

  // Рассылка идёт внутри пути записи счёта и уронить его не имеет права.
  assert.doesNotThrow(() => publish(t, frame()));
  assert.equal(seen.length, 1);
  assert.equal(subscriberCount(t), 1);
});

test('подписчик, отписавшийся во время рассылки, не отбирает кадр у следующего', () => {
  const seen: LiveFrame[] = [];
  const t = topic('self-unsubscribe');
  const off = subscribe(t, () => off());
  subscribe(t, (f) => seen.push(f));

  publish(t, frame());

  assert.equal(seen.length, 1);
});

test('рассылка в неизвестную тему ничего не создаёт', () => {
  const t = topic('unknown');

  assert.doesNotThrow(() => publish(t, frame()));
  assert.equal(hasTopic(t), false);
});

test('publishTournament попадает в тему турнира событием tournament', () => {
  const seen: LiveFrame[] = [];
  subscribe(tournamentTopic('t1'), (f) => seen.push(f));

  publishTournament(tournament({ name: 'Мексикано' }));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].event, 'tournament');
  const sent = JSON.parse(seen[0].data) as TournamentDetail;
  assert.equal(sent.id, 't1');
  assert.equal(sent.name, 'Мексикано');
});

test('publishTournament без подписчиков не сериализует турнир', () => {
  // Геттер, который бросает: если сериализация всё-таки случится, тест упадёт.
  const trap = {
    id: 'no-listeners',
    get name(): string {
      throw new Error('сериализовать было незачем');
    },
  } as unknown as TournamentDetail;

  assert.doesNotThrow(() => publishTournament(trap));
});

test('хаб лежит на globalThis', () => {
  // Контракт, из-за которого рассылка вообще работает: route-хендлеры и
  // серверные компоненты Next собираются в разные бандлы, и модульная
  // переменная разъехалась бы на два экземпляра.
  subscribe(topic('global'), () => {});

  assert.ok(globalThis.__padelLiveHub instanceof Map);
});
