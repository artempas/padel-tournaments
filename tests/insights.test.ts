import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceContext,
  dynamicsInsights,
  matchBalance,
  positionsById,
  roundHistory,
  tournamentInsights,
} from '../src/lib/insights.ts';
import type { Match, Player } from '../src/lib/types.ts';

const players: Player[] = [
  { id: 'a', name: 'Аня', seat: 0 },
  { id: 'b', name: 'Боря', seat: 1 },
  { id: 'c', name: 'Вика', seat: 2 },
  { id: 'd', name: 'Гена', seat: 3 },
];

/** Матч на 24 очка: раунд и корт по порядку, счёт — как в жизни. */
function match(round: number, team1: [string, string], score1: number, team2: [string, string]): Match {
  return {
    id: `m${round}`,
    round,
    court: 1,
    team1,
    team2,
    score1,
    score2: 24 - score1,
  };
}

const ids = (list: { id: string }[]): string[] => list.map((i) => i.id);

// Ровный турнир: шесть матчей, все три пары сыграли по два раза.
const evenTournament: Match[] = [
  match(1, ['a', 'b'], 16, ['c', 'd']),
  match(2, ['a', 'c'], 14, ['b', 'd']),
  match(3, ['a', 'd'], 13, ['b', 'c']),
  match(4, ['a', 'b'], 18, ['c', 'd']),
  match(5, ['a', 'c'], 12, ['b', 'd']),
  match(6, ['a', 'd'], 15, ['b', 'c']),
];

// Гена начинает последним и выигрывает турнир.
const comeback: Match[] = [
  match(1, ['a', 'b'], 24, ['c', 'd']),
  match(2, ['c', 'd'], 24, ['a', 'b']),
  match(3, ['d', 'a'], 24, ['b', 'c']),
  match(4, ['d', 'b'], 24, ['a', 'c']),
  match(5, ['d', 'c'], 24, ['a', 'b']),
];

test('сила команд без второго матча не считается', () => {
  const matches = [match(1, ['a', 'b'], 20, ['c', 'd'])];
  assert.equal(matchBalance(balanceContext(matches), matches[0]), null);
});

test('равные по остальным матчам команды помечаются знаком равенства', () => {
  const matches = [
    match(1, ['a', 'b'], 12, ['c', 'd']),
    match(2, ['a', 'c'], 12, ['b', 'd']),
    match(3, ['a', 'd'], 12, ['b', 'c']),
  ];
  const balance = matchBalance(balanceContext(matches), matches[0]);

  assert.equal(balance?.symbols, '=');
  assert.equal(balance?.stronger, null);
});

test('острие смотрит на слабую команду, а число символов — на разрыв', () => {
  const matches = [
    match(1, ['a', 'b'], 20, ['c', 'd']),
    match(2, ['a', 'b'], 20, ['c', 'd']),
    match(3, ['a', 'b'], 20, ['c', 'd']),
  ];
  const context = balanceContext(matches);

  const first = matchBalance(context, matches[0]);
  assert.equal(first?.symbols, '>>>');
  assert.equal(first?.stronger, 1);

  // Та же четвёрка, но сильные записаны второй командой.
  const mirrored = matches.map((m) => ({
    ...m,
    team1: m.team2,
    team2: m.team1,
    score1: m.score2,
    score2: m.score1,
  }));
  assert.equal(matchBalance(balanceContext(mirrored), mirrored[0])?.symbols, '<<<');
});

test('счёт самого матча на оценку сил не влияет', () => {
  const matches = [
    match(1, ['a', 'b'], 24, ['c', 'd']),
    match(2, ['a', 'c'], 12, ['b', 'd']),
    match(3, ['a', 'd'], 12, ['b', 'c']),
  ];
  // Разгром в первом матче — единственное, что отличает команды, и именно он
  // из расчёта исключён: по остальным встречам все четверо равны.
  assert.equal(matchBalance(balanceContext(matches), matches[0])?.symbols, '=');
});

test('на трёх матчах фактов ещё нет', () => {
  assert.deepEqual(tournamentInsights(players, evenTournament.slice(0, 3)), []);
});

test('незаконченные матчи в фактах не участвуют', () => {
  const matches = evenTournament.map((m) => ({ ...m, score1: null, score2: null }));
  assert.deepEqual(tournamentInsights(players, matches), []);
});

test('лучшая пара, химия и «кто тащил» — из ровного турнира', () => {
  const insights = tournamentInsights(players, evenTournament);

  const best = insights.find((i) => i.id === 'best-pair');
  assert.ok(best);
  assert.match(best.text, /Аня и Боря/);
  // Две победы в двух матчах — это стоит назвать вслух.
  assert.match(best.text, /все выиграны/);

  // Аня с Геной вместе брали больше, чем каждый из них с другими.
  assert.match(insights.find((i) => i.id === 'chemistry')?.text ?? '', /Аня и Гена/);
  assert.match(insights.find((i) => i.id === 'carried')?.text ?? '', /^Аня/);
});

test('пара, сыгравшая вместе один раз, лучшей не становится', () => {
  const six: Player[] = [
    ...players,
    { id: 'e', name: 'Даша', seat: 4 },
    { id: 'f', name: 'Егор', seat: 5 },
  ];
  // Ни одного повтора: Аня с Борей взяли всё, но одного матча для вывода мало.
  const insights = tournamentInsights(six, [
    match(1, ['a', 'b'], 24, ['c', 'd']),
    match(2, ['a', 'c'], 12, ['e', 'f']),
    match(3, ['b', 'e'], 12, ['d', 'f']),
    match(4, ['a', 'd'], 12, ['b', 'f']),
  ]);

  assert.equal(
    insights.find((i) => i.id === 'best-pair'),
    undefined,
  );
});

test('самый близкий матч попадает в факты, а разгром — только крупный', () => {
  const insights = tournamentInsights(players, evenTournament);

  // 12:12 в пятом раунде.
  assert.match(insights.find((i) => i.id === 'closest')?.text ?? '', /12:12/);
  // Максимальная разница здесь 12 очков из 24 — на разгром не тянет.
  assert.equal(
    insights.find((i) => i.id === 'blowout'),
    undefined,
  );
});

test('сухой матч называется баранкой', () => {
  const blowout = tournamentInsights(players, [
    ...evenTournament.slice(0, 3),
    match(4, ['a', 'b'], 24, ['c', 'd']),
  ]).find((i) => i.id === 'blowout');

  assert.equal(blowout?.title, 'Баранка');
  assert.match(blowout?.text ?? '', /24:0/);
});

test('таблица собирается после каждого раунда, где что-то сыграно', () => {
  const history = roundHistory(players, [
    ...evenTournament.slice(0, 2),
    { ...evenTournament[2], score1: null, score2: null },
  ]);

  assert.deepEqual(
    history.map((h) => h.round),
    [1, 2],
  );
  assert.deepEqual(
    history[1].standings.map((s) => [s.name, s.pointsFor]),
    [
      ['Аня', 30],
      ['Боря', 26],
      ['Вика', 22],
      ['Гена', 18],
    ],
  );
});

test('места по раундам — по одному числу на срез', () => {
  const positions = positionsById(roundHistory(players, comeback));
  assert.deepEqual(positions.get('d'), [4, 4, 2, 1, 1]);
  assert.deepEqual(positions.get('a'), [1, 1, 1, 2, 2]);
});

test('двух раундов для динамики мало', () => {
  assert.deepEqual(dynamicsInsights(players, comeback.slice(0, 2)), []);
});

test('камбэк, момент захвата первого места и отрыв', () => {
  const insights = dynamicsInsights(players, comeback);

  assert.deepEqual(ids(insights).sort(), ['comeback', 'dominant', 'lead-since', 'second-wind']);
  assert.equal(
    insights.find((i) => i.id === 'comeback')?.text,
    'Гена: 4-е место после 1-го раунда → 1-е в итоге',
  );
  assert.match(insights.find((i) => i.id === 'lead-since')?.text ?? '', /с 4-го раунда/);
});

test('лидер с первого раунда до последнего — отдельный факт', () => {
  const insights = dynamicsInsights(players, evenTournament);
  assert.equal(insights.find((i) => i.id === 'wire-to-wire')?.text, 'Аня — первое место после каждого раунда турнира');
  assert.equal(
    insights.find((i) => i.id === 'comeback'),
    undefined,
  );
});
