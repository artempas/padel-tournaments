import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_MATCHES,
  computeRatings,
  matchRatings,
  RATING_TIERS,
  ratingHistory,
  START_RATING,
  tierOf,
  type MatchRating,
  type PlayedMatch,
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

// ---- Снимки по матчам ------------------------------------------------------

test('снимок матча — это рейтинг сразу после него, а не сегодняшний', () => {
  const first = match({ scoreA: 12, scoreB: 4 });
  const second = match({ scoreA: 4, scoreB: 12 });

  const shots = matchRatings([first, second]) as MatchRating[];

  // После первого матча «a» поднялся на 4.5 — 100 + 4.5 округляется до 105.
  assert.equal(shots[0].teamA.players[0].rating, 105);
  assert.equal(shots[0].teamA.players[0].delta, 5);

  // Второй матч его опустил, но первый снимок этого уже не видит.
  assert.ok(shots[1].teamA.players[0].rating < shots[0].teamA.players[0].rating);
  assert.equal(shots[0].teamA.players[0].rating, 105);
});

test('снимок последнего матча совпадает с итоговой таблицей', () => {
  const history = [
    match({ scoreA: 13, scoreB: 3 }),
    match({ teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 6, scoreB: 10 }),
    match({ teamA: ['a', 'd'], teamB: ['b', 'c'], scoreA: 9, scoreB: 7 }),
  ];

  const shots = matchRatings(history) as MatchRating[];
  const table = computeRatings(history);
  const last = shots[shots.length - 1];

  for (const side of [last.teamA, last.teamB]) {
    for (const player of side.players) {
      assert.equal(player.rating, Math.round(table.get(player.id)!.rating));
    }
  }
});

test('изменения по матчам складываются в изменение за турнир', () => {
  const history = [
    match({ scoreA: 13, scoreB: 3 }),
    match({ teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 6, scoreB: 10 }),
    match({ teamA: ['a', 'd'], teamB: ['b', 'c'], scoreA: 9, scoreB: 7 }),
    match({ scoreA: 7, scoreB: 9 }),
  ];
  const before = seeded({ a: 121, b: 94, c: 107, d: 100 }, 12);

  const shots = matchRatings(history, before) as MatchRating[];
  const table = computeRatings(history, before);

  for (const [id, start] of before) {
    const moved = shots
      .flatMap((s) => [...s.teamA.players, ...s.teamB.players])
      .filter((p) => p.id === id)
      .reduce((sum, p) => sum + p.delta, 0);

    assert.equal(moved, Math.round(table.get(id)!.rating) - Math.round(start.rating));
  }
});

test('средний рейтинг пары — среднее двоих на тот же момент', () => {
  const shots = matchRatings(
    [match({ scoreA: 16, scoreB: 0 })],
    seeded({ a: 140, b: 120, c: 100, d: 100 }),
  ) as MatchRating[];

  const [first, second] = shots[0].teamA.players;
  assert.equal(shots[0].teamA.rating, Math.round((first.rating + second.rating) / 2));
  // Пара выиграла — среднее выросло относительно (140 + 120) / 2.
  assert.equal(shots[0].teamA.delta, shots[0].teamA.rating - 130);
  assert.ok(shots[0].teamA.delta > 0);
  // Проигравшая сторона на столько же вниз: опыт у всех четверых одинаковый.
  assert.equal(shots[0].teamB.delta, -shots[0].teamA.delta);
});

test('игроки в снимке стоят в том же порядке, в каком их подали', () => {
  const shots = matchRatings([
    match({ teamA: ['ольга', 'пётр'], teamB: ['аня', 'женя'], scoreA: 10, scoreB: 6 }),
  ]) as MatchRating[];

  assert.deepEqual(
    shots[0].teamA.players.map((p) => p.id),
    ['ольга', 'пётр'],
  );
  assert.deepEqual(
    shots[0].teamB.players.map((p) => p.id),
    ['аня', 'женя'],
  );
});

test('у матча без счёта снимка нет, но место в ответе остаётся', () => {
  const shots = matchRatings([match({ scoreA: 0, scoreB: 0 }), match({ scoreA: 12, scoreB: 4 })]);

  assert.equal(shots.length, 2);
  assert.equal(shots[0], null);
  assert.notEqual(shots[1], null);
  // Несыгранный матч не должен был завести игрокам ни рейтинга, ни опыта.
  assert.equal(shots[1]!.teamA.players[0].rating - shots[1]!.teamA.players[0].delta, START_RATING);
});

// ---- История по турнирам ---------------------------------------------------

function played(tournamentId: string, over: Partial<RatedMatch>): PlayedMatch {
  return {
    ...match(over),
    tournamentId,
    tournamentName: `Турнир ${tournamentId}`,
    at: `2026-0${tournamentId}-01T18:00:00.000Z`,
  };
}

test('история режется на турниры, а матчи остаются внутри точек', () => {
  const history = ratingHistory([
    played('1', { scoreA: 12, scoreB: 4 }),
    played('1', { teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 6, scoreB: 10 }),
    played('2', { scoreA: 4, scoreB: 12 }),
  ]);

  const points = history.get('a')!;
  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map((p) => p.tournamentId),
    ['1', '2'],
  );
  assert.equal(points[0].matches.length, 2);
  assert.equal(points[1].matches.length, 1);
  assert.equal(points[0].at, '2026-01-01T18:00:00.000Z');
});

test('точка турнира — рейтинг на его конец, а дельта складывается из матчей', () => {
  const points = ratingHistory([
    played('1', { scoreA: 12, scoreB: 4 }),
    played('1', { teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 14, scoreB: 2 }),
  ]).get('a')!;

  const point = points[0];
  assert.equal(point.rating, point.matches[point.matches.length - 1].rating);
  assert.equal(
    point.delta,
    point.matches.reduce((sum, m) => sum + m.delta, 0),
  );
  // Дельта турнира — это в точности путь от старта до его конца.
  assert.equal(point.rating - point.delta, START_RATING);
});

test('последняя точка истории совпадает с итоговым рейтингом', () => {
  const matches = [
    played('1', { scoreA: 13, scoreB: 3 }),
    played('1', { teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 6, scoreB: 10 }),
    played('2', { teamA: ['a', 'd'], teamB: ['b', 'c'], scoreA: 9, scoreB: 7 }),
  ];

  const history = ratingHistory(matches);
  const table = computeRatings(matches);

  for (const [id, points] of history) {
    assert.equal(points[points.length - 1].rating, Math.round(table.get(id)!.rating));
  }
});

test('в матче видно, с кем и против кого играли — с точки зрения каждого', () => {
  const points = ratingHistory([
    played('1', { teamA: ['аня', 'боря'], teamB: ['вера', 'гена'], scoreA: 12, scoreB: 4 }),
  ]);

  const mine = points.get('аня')![0].matches[0];
  assert.equal(mine.partnerId, 'боря');
  assert.deepEqual(mine.opponentIds, ['вера', 'гена']);
  assert.equal(mine.scoreFor, 12);
  assert.equal(mine.scoreAgainst, 4);

  // У соперника тот же матч зеркален: счёт наоборот, рейтинг в другую сторону.
  // Ровно противоположным числом дельта быть не обязана — она считается по
  // округлённым рейтингам, а 104.5 и 95.5 округляются в одну сторону.
  const theirs = points.get('вера')![0].matches[0];
  assert.equal(theirs.scoreFor, 4);
  assert.equal(theirs.scoreAgainst, 12);
  assert.ok(mine.delta > 0 && theirs.delta < 0);
  assert.deepEqual(theirs.opponentIds, ['аня', 'боря']);
});

test('несыгранный матч не заводит игроку ни точки, ни турнира', () => {
  const history = ratingHistory([
    played('1', { scoreA: 0, scoreB: 0 }),
    played('2', { scoreA: 12, scoreB: 4 }),
  ]);

  const points = history.get('a')!;
  assert.equal(points.length, 1);
  assert.equal(points[0].tournamentId, '2');
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
