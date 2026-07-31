import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_MATCHES,
  computeRatings,
  RATING_TIERS,
  START_RATING,
  tierOf,
  type Rating,
  type RatedMatch,
} from '../src/lib/rating.ts';

function match(over: Partial<RatedMatch>): RatedMatch {
  return { teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 8, scoreB: 8, ...over };
}

/** Готовое состояние: рейтинг задан, опыта много — значит K уже минимальный. */
function seeded(entries: Record<string, number>, matches = 50): Array<[string, Rating]> {
  return Object.entries(entries).map(([id, rating]) => [id, { rating, matches }]);
}

test('всех незнакомых игроков рейтинг встречает одинаково', () => {
  const table = computeRatings([match({ scoreA: 8, scoreB: 8 })]);

  assert.equal(table.size, 4);
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(table.get(id)!.rating, START_RATING);
    assert.equal(table.get(id)!.matches, 1);
  }
});

test('победа над равными поднимает обоих, поражение опускает на столько же', () => {
  const table = computeRatings([match({ scoreA: 12, scoreB: 4 })]);

  // K = 18 у новичка, ожидание 0.5 при равных рейтингах: 18 × (0.75 − 0.5).
  assert.equal(table.get('a')!.rating, START_RATING + 4.5);
  assert.equal(table.get('b')!.rating, START_RATING + 4.5);
  assert.equal(table.get('c')!.rating, START_RATING - 4.5);
  assert.equal(table.get('d')!.rating, START_RATING - 4.5);
});

test('разгром двигает рейтинг сильнее, чем победа на последнем мяче', () => {
  const rout = computeRatings([match({ scoreA: 16, scoreB: 0 })]).get('a')!.rating;
  const squeak = computeRatings([match({ scoreA: 9, scoreB: 7 })]).get('a')!.rating;

  assert.equal(rout - START_RATING, 9); // 18 × (1.00 − 0.5)
  assert.equal(squeak - START_RATING, 1.125); // 18 × (0.5625 − 0.5)
  assert.ok(rout > squeak);
});

test('ожидаемая победа не приносит почти ничего', () => {
  // Разрыв 86 — ровно тот, при котором шкала ждёт от сильной пары 12:4.
  const before = seeded({ a: 186, b: 186, c: 100, d: 100 });

  const asExpected = computeRatings([match({ scoreA: 12, scoreB: 4 })], before);
  assert.ok(Math.abs(asExpected.get('a')!.rating - 186) < 0.1);

  // Та же победа, но заметно крупнее ожидаемой — уже прибавка.
  const better = computeRatings([match({ scoreA: 14, scoreB: 2 })], before);
  assert.ok(better.get('a')!.rating > 187);

  // И наоборот: выиграть у слабых слишком скромно — потерять рейтинг.
  const worse = computeRatings([match({ scoreA: 10, scoreB: 6 })], before);
  assert.ok(worse.get('a')!.rating < 185);
});

test('турниры с разной нормой очков сравнимы между собой', () => {
  const to16 = computeRatings([match({ scoreA: 12, scoreB: 4 })]).get('a')!.rating;
  const to32 = computeRatings([match({ scoreA: 24, scoreB: 8 })]).get('a')!.rating;

  assert.equal(to16, to32);
});

test('при равном опыте рейтинг перекладывается, а не появляется', () => {
  const table = computeRatings(
    [
      match({ scoreA: 13, scoreB: 3 }),
      match({ teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 6, scoreB: 10 }),
      match({ teamA: ['a', 'd'], teamB: ['b', 'c'], scoreA: 9, scoreB: 7 }),
    ],
    seeded({ a: 100, b: 100, c: 100, d: 100 }),
  );

  const total = [...table.values()].reduce((sum, r) => sum + r.rating, 0);
  assert.ok(Math.abs(total - 4 * 100) < 1e-9);
});

test('с опытом один и тот же результат двигает рейтинг слабее', () => {
  const result = { scoreA: 12, scoreB: 4 };
  const move = (matches: number) =>
    computeRatings([match(result)], seeded({ a: 100, b: 100, c: 100, d: 100 }, matches)).get('a')!
      .rating - 100;

  assert.equal(move(0), 4.5); // K = 18
  assert.equal(move(10), 3.5); // K = 14
  assert.equal(move(30), 2.75); // K = 11
  assert.equal(move(300), 2.75); // дальше не падает
});

test('счёт 0:0 не считается сыгранным матчем', () => {
  const table = computeRatings([match({ scoreA: 0, scoreB: 0 })]);
  assert.equal(table.size, 0);
});

test('порядок матчей влияет на итог — рейтинг путезависим', () => {
  // Первый матч разводит будущих партнёра и соперников по силе, поэтому во
  // втором «a» встречает уже не тех людей, что в обратном порядке. Отсюда и
  // требование к вызывающему: подавать матчи в том порядке, в каком играли.
  const shuffle = match({ teamA: ['b', 'c'], teamB: ['d', 'e'], scoreA: 16, scoreB: 0 });
  const then = match({ teamA: ['a', 'b'], teamB: ['d', 'e'], scoreA: 12, scoreB: 4 });

  const forwards = computeRatings([shuffle, then]).get('a')!.rating;
  const backwards = computeRatings([then, shuffle]).get('a')!.rating;

  // Сыграв после разгрома, «a» выходит с сильным партнёром против побитых —
  // победа ожидаема и стоит меньше.
  assert.ok(forwards < backwards);
});

test('продолжение с известного состояния равно сквозному счёту', () => {
  const history = [match({ scoreA: 12, scoreB: 4 }), match({ scoreA: 5, scoreB: 11 })];
  const rest = [match({ teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 10, scoreB: 6 })];

  const straight = computeRatings([...history, ...rest]);
  const resumed = computeRatings(rest, computeRatings(history));

  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(resumed.get(id)!.rating, straight.get(id)!.rating);
    assert.equal(resumed.get(id)!.matches, straight.get(id)!.matches);
  }
});

test('исходное состояние не портится расчётом', () => {
  const before = new Map(seeded({ a: 186, b: 186, c: 100, d: 100 }));
  computeRatings([match({ scoreA: 16, scoreB: 0 })], before);

  assert.equal(before.get('a')!.rating, 186);
  assert.equal(before.get('a')!.matches, 50);
});

// ---- Ступени ---------------------------------------------------------------

test('пока матчей мало, ступени нет — даже у высокого рейтинга', () => {
  for (const rating of [40, 100, 200]) {
    assert.equal(tierOf(rating, CALIBRATION_MATCHES - 1).id, 'calibration');
  }
  // Ровно на границе калибровка кончается.
  assert.notEqual(tierOf(100, CALIBRATION_MATCHES).id, 'calibration');
});

test('границы ступеней', () => {
  const at = (rating: number) => tierOf(rating, 50).id;

  assert.equal(at(150), 'diamond');
  assert.equal(at(149), 'platinum');
  assert.equal(at(130), 'platinum');
  assert.equal(at(129), 'gold');
  assert.equal(at(110), 'gold');
  assert.equal(at(109), 'silver');
  assert.equal(at(80), 'silver');
  assert.equal(at(79), 'bronze');
  assert.equal(at(0), 'bronze');
});

test('новичок выходит из калибровки на ступени «как все»', () => {
  assert.equal(tierOf(START_RATING, CALIBRATION_MATCHES).id, 'silver');
});

test('ступень берётся от показанного числа, а не от дробного', () => {
  // 109.6 на экране станет «110» — значит и ступень должна быть золотой,
  // иначе рядом окажутся порог золота и значок серебра.
  assert.equal(tierOf(109.6, 50).id, 'gold');
  assert.equal(tierOf(109.4, 50).id, 'silver');
});

test('ступени идут сверху вниз и покрывают шкалу без дыр', () => {
  // От этого зависит tierOf: она берёт первую подходящую сверху. И легенда на
  // экране, которая читает нижнюю границу соседа снизу.
  const floors = RATING_TIERS.map((t) => t.floor);
  assert.equal(floors[floors.length - 1], null, 'у нижней ступени порога быть не должно');

  const rest = floors.slice(0, -1) as number[];
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
  assert.equal(new Set(RATING_TIERS.map((t) => t.id)).size, RATING_TIERS.length);
});
