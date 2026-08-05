import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, restCounts, restingInRound } from '../src/lib/standings.ts';
import type { Match, Player } from '../src/lib/types.ts';

const players: Player[] = [
  { id: 'a', name: 'Аня', seat: 0 },
  { id: 'b', name: 'Боря', seat: 1 },
  { id: 'c', name: 'Вика', seat: 2 },
  { id: 'd', name: 'Гена', seat: 3 },
  { id: 'e', name: 'Даша', seat: 4 },
  { id: 'f', name: 'Егор', seat: 5 },
];

function match(over: Partial<Match>): Match {
  return {
    id: 'm',
    round: 1,
    court: 1,
    team1: ['a', 'b'],
    team2: ['c', 'd'],
    score1: null,
    score2: null,
    ...over,
  };
}

test('a player scores the points their team scored', () => {
  const standings = computeStandings(players, [
    match({ id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 11, score2: 5 }),
  ]);
  const byId = new Map(standings.map((s) => [s.playerId, s]));

  assert.equal(byId.get('a')!.pointsFor, 11);
  assert.equal(byId.get('b')!.pointsFor, 11);
  assert.equal(byId.get('c')!.pointsFor, 5);
  assert.equal(byId.get('a')!.pointsAgainst, 5);
  assert.equal(byId.get('a')!.diff, 6);
});

test('points accumulate across every match a player appears in', () => {
  const standings = computeStandings(players, [
    match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'], score1: 11, score2: 5 }),
    match({ id: 'm2', round: 2, team1: ['a', 'c'], team2: ['b', 'd'], score1: 6, score2: 10 }),
  ]);
  const byId = new Map(standings.map((s) => [s.playerId, s]));

  assert.equal(byId.get('a')!.pointsFor, 17);
  assert.equal(byId.get('a')!.played, 2);
  assert.equal(byId.get('b')!.pointsFor, 21);
  assert.equal(byId.get('d')!.pointsFor, 15);
});

test('wins, draws and losses are tracked', () => {
  const standings = computeStandings(players, [
    match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'], score1: 11, score2: 5 }),
    match({ id: 'm2', round: 2, team1: ['a', 'c'], team2: ['b', 'd'], score1: 8, score2: 8 }),
  ]);
  const byId = new Map(standings.map((s) => [s.playerId, s]));

  assert.deepEqual(
    [byId.get('a')!.wins, byId.get('a')!.draws, byId.get('a')!.losses],
    [1, 1, 0],
  );
  assert.deepEqual(
    [byId.get('d')!.wins, byId.get('d')!.draws, byId.get('d')!.losses],
    [0, 1, 1],
  );
});

test('unscored matches are ignored', () => {
  const standings = computeStandings(players, [match({ id: 'm1' })]);
  assert.ok(standings.every((s) => s.played === 0 && s.pointsFor === 0));
});

test('ranking is by points, then difference, then wins', () => {
  const standings = computeStandings(players, [
    match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'], score1: 10, score2: 6 }),
    match({ id: 'm2', round: 2, team1: ['a', 'c'], team2: ['b', 'd'], score1: 9, score2: 7 }),
  ]);

  // a: 19 (+6), b: 17 (+0), c: 15 (-2), d: 13 (-4)
  assert.deepEqual(
    standings.slice(0, 4).map((s) => [s.name, s.pointsFor]),
    [
      ['Аня', 19],
      ['Боря', 17],
      ['Вика', 15],
      ['Гена', 13],
    ],
  );
});

test('every point scored lands in exactly one player total', () => {
  const matches = [
    match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'], score1: 11, score2: 5 }),
    match({ id: 'm2', round: 2, team1: ['e', 'f'], team2: ['a', 'c'], score1: 8, score2: 8 }),
  ];
  const total = computeStandings(players, matches).reduce((s, r) => s + r.pointsFor, 0);
  assert.equal(total, (16 + 16) * 2);
});

test('bench time counts rounds a player was not scheduled in', () => {
  const rested = restCounts(players, [
    match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'] }),
    match({ id: 'm2', round: 2, team1: ['a', 'b'], team2: ['e', 'f'] }),
  ]);

  assert.deepEqual([...rested.entries()].sort(), [
    ['a', 0],
    ['b', 0],
    ['c', 1],
    ['d', 1],
    ['e', 1],
    ['f', 1],
  ]);
});

test('bench time counts scheduled rounds, not scored ones', () => {
  // Счёт первого раунда ещё не внесли — на скамейке от этого никто не сидел.
  const rested = restCounts(players, [
    match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'] }),
    match({ id: 'm2', round: 2, team1: ['e', 'f'], team2: ['c', 'd'], score1: 9, score2: 7 }),
  ]);

  assert.equal(rested.get('a'), 1);
  assert.equal(rested.get('c'), 0);
  assert.equal(rested.get('e'), 1);
});

test('resting players are those absent from the round', () => {
  const matches = [match({ id: 'm1', round: 1, team1: ['a', 'b'], team2: ['c', 'd'] })];
  assert.deepEqual(
    restingInRound(players, matches, 1).map((p) => p.id),
    ['e', 'f'],
  );
  // A round with no matches means nobody is on court.
  assert.equal(restingInRound(players, matches, 2).length, players.length);
});
