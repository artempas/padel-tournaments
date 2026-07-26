import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomTournamentName } from '../src/lib/tournament-names.ts';

/** Cycles deterministically through [0, 1) so every branch can be reached. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

test('produces a capitalised two-word name', () => {
  for (let i = 0; i < 200; i++) {
    const name = randomTournamentName();
    assert.match(name, /^[А-ЯЁ][а-яё]+ [а-яё]+$/u, `unexpected shape: ${name}`);
  }
});

test('fits the tournament name length limit', () => {
  for (let i = 0; i < 200; i++) {
    assert.ok(randomTournamentName().length <= 80);
  }
});

test('a low roll names the weekday', () => {
  // 2026-07-24 is a Friday.
  const name = randomTournamentName({
    now: new Date(2026, 6, 24, 19),
    random: sequence([0.1, 0]),
  });
  assert.match(name, /^Пятничный /);
});

test('a middle roll names the time of day', () => {
  const morning = randomTournamentName({
    now: new Date(2026, 6, 24, 9),
    random: sequence([0.4, 0]),
  });
  assert.match(morning, /^Утренний /);

  const evening = randomTournamentName({
    now: new Date(2026, 6, 24, 20),
    random: sequence([0.4, 0]),
  });
  assert.match(evening, /^Вечерний /);
});

test('a high roll uses a free adjective', () => {
  const name = randomTournamentName({
    now: new Date(2026, 6, 24, 19),
    random: sequence([0.9, 0, 0]),
  });
  assert.doesNotMatch(name, /^(Пятничный|Вечерний) /);
});

test('a random() returning almost 1 still indexes inside the word lists', () => {
  const name = randomTournamentName({ random: () => 0.999999999 });
  assert.match(name, /^[А-ЯЁ][а-яё]+ [а-яё]+$/u);
});

test('generates a decent spread of names', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) seen.add(randomTournamentName());
  assert.ok(seen.size > 50, `only ${seen.size} distinct names`);
});
