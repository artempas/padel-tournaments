import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultsFileName, resultsSummary, type ResultsCardData } from '../src/lib/results-card.ts';
import type { Standing } from '../src/lib/types.ts';

function standing(name: string, pointsFor: number): Standing {
  return {
    playerId: name,
    name,
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    pointsFor,
    pointsAgainst: 40,
    diff: pointsFor - 40,
  };
}

function card(over: Partial<ResultsCardData> = {}): ResultsCardData {
  return {
    name: 'Синий фламинго',
    format: 'Американо',
    date: '2026-07-28T18:30:00.000Z',
    finished: true,
    playedCount: 12,
    totalMatches: 12,
    standings: [standing('Аня', 58), standing('Боря', 41)],
    ...over,
  };
}

test('доигранный турнир подписан победителем', () => {
  const { headline, detail } = resultsSummary(card());

  assert.equal(headline, 'Турнир завершён');
  assert.equal(detail, 'Победитель — Аня, 58 очков');
});

test('незакрытые матчи делают завершение досрочным и попадают в подпись', () => {
  const { headline, detail } = resultsSummary(card({ playedCount: 9 }));

  assert.equal(headline, 'Турнир завершён досрочно');
  assert.equal(detail, 'Победитель — Аня, 58 очков. Не сыграно 3 матча');
});

test('незавершённый турнир показывает лидера и прогресс', () => {
  const { headline, detail } = resultsSummary(card({ finished: false, playedCount: 5 }));

  assert.equal(headline, 'Турнир идёт');
  assert.equal(detail, 'Впереди Аня, 58 очков. Сыграно 5 из 12');
});

test('без сыгранных матчей победителя не называют', () => {
  const { headline, detail } = resultsSummary(card({ finished: false, playedCount: 0 }));

  assert.equal(headline, 'Турнир идёт');
  assert.equal(detail, 'Ни одного матча не сыграно');
});

test('склонение очков идёт по русским правилам', () => {
  const one = resultsSummary(card({ standings: [standing('Аня', 21)] }));
  const few = resultsSummary(card({ standings: [standing('Аня', 22)] }));

  assert.equal(one.detail, 'Победитель — Аня, 21 очко');
  assert.equal(few.detail, 'Победитель — Аня, 22 очка');
});

test('имя файла — латиница с датой турнира', () => {
  assert.equal(resultsFileName(card()), 'padel-2026-07-28.png');
  assert.equal(resultsFileName(card({ date: 'что угодно' })), 'padel-results.png');
});
