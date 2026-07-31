import { plural } from './plural.ts';
import { computeStandings } from './standings.ts';
import type { Match, Player, Standing } from './types';

/**
 * Факты о турнире: химия пар, драматизм матчей, динамика по раундам.
 *
 * Считается из того, что уже есть на экране — составы и счёт, — поэтому ни
 * запроса, ни новых таблиц не нужно.
 *
 * Сквозной принцип: турнир — это 5–8 матчей на игрока, и разница в пару очков
 * между вторым и пятым местом честнее объясняется жребием, чем игрой. Поэтому
 * у каждого факта два порога: сколько нужно матчей и насколько велика должна
 * быть разница, чтобы о ней стоило говорить. Не набралось — факта просто нет,
 * пустых карточек с «примерно поровну» здесь не бывает.
 *
 * Сила игрока везде считается одинаково — долей взятых очков от разыгранных
 * в его матчах. Не суммой: при нечётном составе кто-то отдыхает, и сумма
 * наказывает за это, а доля нет. Норму очков за матч спрашивать не нужно —
 * сколько разыграно, видно по самому счёту.
 */

export interface Insight {
  id: string;
  icon: string;
  title: string;
  text: string;
}

/** Матч со внесённым счётом: дальше по коду счёт уже не может быть null. */
type PlayedMatch = Match & { score1: number; score2: number };

interface Side {
  ids: [string, string];
  got: number;
  lost: number;
}

/** Очки игрока и сколько всего разыграно в матчах, где он выходил. */
interface Tally {
  points: number;
  of: number;
  played: number;
}

function playedMatches(matches: Match[]): PlayedMatch[] {
  return matches.filter((m): m is PlayedMatch => m.score1 !== null && m.score2 !== null);
}

function sidesOf(m: PlayedMatch): [Side, Side] {
  return [
    { ids: m.team1, got: m.score1, lost: m.score2 },
    { ids: m.team2, got: m.score2, lost: m.score1 },
  ];
}

function totalOf(m: PlayedMatch): number {
  return m.score1 + m.score2;
}

function tallyPlayers(ms: PlayedMatch[]): Map<string, Tally> {
  const table = new Map<string, Tally>();
  for (const m of ms) {
    const total = totalOf(m);
    for (const side of sidesOf(m)) {
      for (const id of side.ids) {
        const row = table.get(id) ?? { points: 0, of: 0, played: 0 };
        row.points += side.got;
        row.of += total;
        row.played++;
        table.set(id, row);
      }
    }
  }
  return table;
}

function averageTotal(ms: PlayedMatch[]): number {
  if (ms.length === 0) return 0;
  return ms.reduce((sum, m) => sum + totalOf(m), 0) / ms.length;
}

function pairKey(ids: [string, string]): string {
  return [...ids].sort().join('|');
}

function teamLabel(ids: [string, string], names: Map<string, string>): string {
  return ids.map((id) => names.get(id) ?? '—').join(' / ');
}

/** «на 3 очка за матч» — доля, переведённая в понятные очки. */
function points(count: number): string {
  return `${count} ${plural(count, 'очко', 'очка', 'очков')}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// ============================================================================
// Сложность жребия: насколько равны команды в конкретном матче
// ============================================================================

export interface MatchBalance {
  /** '=' либо '>' / '<', повторённые 1–3 раза; острие смотрит на слабых. */
  symbols: string;
  level: 0 | 1 | 2 | 3;
  /** Какая сторона сильнее: 1, 2 или никакая. */
  stronger: 1 | 2 | null;
  /** «равны по силе», «немного сильнее», … — без склонений и рода. */
  wording: string;
  /** Разница в силе, переведённая в очки за матч. */
  gapPoints: number;
}

export interface BalanceContext {
  tallies: Map<string, Tally>;
  avgTotal: number;
}

/**
 * Пороги разницы долей: «немного», «заметно», «намного».
 *
 * Доля сильного игрока за турнир — это примерно 0.58 против 0.42 у слабого,
 * а команда усредняет двоих, поэтому разрыв между сильнейшей и слабейшей
 * четвёркой редко переваливает за 0.15. Отсюда и шкала: 0.12 — это уже край
 * возможного, а не «чуть больше среднего».
 */
const BALANCE_STEPS = [0.025, 0.06, 0.12];

const BALANCE_WORDING = ['равны по силе', 'немного сильнее', 'заметно сильнее', 'намного сильнее'];

export function balanceContext(matches: Match[]): BalanceContext {
  const ms = playedMatches(matches);
  return { tallies: tallyPlayers(ms), avgTotal: averageTotal(ms) };
}

/**
 * Сила игрока по всем его матчам, кроме этого.
 *
 * Исключить оценваемый матч обязательно: иначе разгром сам поднимает силу
 * победителей, и чип превращается в пересказ счёта. «Команды были равны, а
 * тут 22:2» — это факт; «сильные выиграли, потому что выиграли» — нет.
 */
function shareWithout(ctx: BalanceContext, id: string, got: number, total: number): number | null {
  const tally = ctx.tallies.get(id);
  if (!tally) return null;
  const of = tally.of - total;
  // Не осталось других матчей — сравнивать не с чем.
  if (of <= 0) return null;
  return (tally.points - got) / of;
}

function teamShareWithout(
  ctx: BalanceContext,
  ids: [string, string],
  got: number,
  total: number,
): number | null {
  const first = shareWithout(ctx, ids[0], got, total);
  const second = shareWithout(ctx, ids[1], got, total);
  if (first === null || second === null) return null;
  return (first + second) / 2;
}

export function matchBalance(ctx: BalanceContext, match: Match): MatchBalance | null {
  if (match.score1 === null || match.score2 === null) return null;

  const total = match.score1 + match.score2;
  const a = teamShareWithout(ctx, match.team1, match.score1, total);
  const b = teamShareWithout(ctx, match.team2, match.score2, total);
  if (a === null || b === null) return null;

  const gap = a - b;
  const level = BALANCE_STEPS.filter((step) => Math.abs(gap) >= step)
    .length as MatchBalance['level'];
  const stronger = level === 0 ? null : gap > 0 ? 1 : 2;

  return {
    symbols: stronger === null ? '=' : (stronger === 1 ? '>' : '<').repeat(level),
    level,
    stronger,
    wording: BALANCE_WORDING[level],
    gapPoints: Math.abs(gap) * ctx.avgTotal,
  };
}

/** Расшифровка чипа словами — для screen reader и подписи под ним. */
export function balanceSummary(balance: MatchBalance, teamA: string, teamB: string): string {
  if (balance.stronger === null) return 'По остальным матчам команды равны по силе';
  const strong = balance.stronger === 1 ? teamA : teamB;
  const gap = Math.max(1, Math.round(balance.gapPoints));
  return `По остальным матчам ${strong} ${balance.wording}: примерно на ${points(gap)} за матч`;
}

// ============================================================================
// Факты о турнире: химия пар и драматизм матчей
// ============================================================================

interface PairTally {
  ids: [string, string];
  matches: number;
  points: number;
  of: number;
  wins: number;
}

/** Меньше — и любая «закономерность» окажется случайностью. */
const MIN_MATCHES_FOR_FACTS = 4;
/** Пара, сыгравшая вместе один матч, — это не пара, а совпадение. */
const MIN_PAIR_MATCHES = 2;
/** Доля, ниже которой «лучшая пара» звучит громче, чем есть. */
const MIN_PAIR_SHARE = 0.55;
/** Прибавка, которую уже нельзя списать на жребий: и в долях, и в очках. */
const MIN_LIFT = 0.06;
const MIN_LIFT_POINTS = 2;

export function tournamentInsights(players: Player[], matches: Match[]): Insight[] {
  const ms = playedMatches(matches);
  if (ms.length < MIN_MATCHES_FOR_FACTS) return [];

  const names = new Map(players.map((p) => [p.id, p.name]));
  const tallies = tallyPlayers(ms);
  const avgTotal = averageTotal(ms);
  const share = (id: string): number => {
    const tally = tallies.get(id);
    return tally && tally.of > 0 ? tally.points / tally.of : 0;
  };

  const pairs = new Map<string, PairTally>();
  const partners = new Map<string, string[]>();

  for (const m of ms) {
    const total = totalOf(m);
    for (const side of sidesOf(m)) {
      const key = pairKey(side.ids);
      const pair = pairs.get(key) ?? { ids: side.ids, matches: 0, points: 0, of: 0, wins: 0 };
      pair.matches++;
      pair.points += side.got;
      pair.of += total;
      if (side.got > side.lost) pair.wins++;
      pairs.set(key, pair);

      const [first, second] = side.ids;
      partners.set(first, [...(partners.get(first) ?? []), second]);
      partners.set(second, [...(partners.get(second) ?? []), first]);
    }
  }

  const bestPair = findBestPair(pairs, names);
  const chemistry = findChemistry(pairs, tallies, names, avgTotal, bestPair?.key);
  const carried = findCarried(tallies, partners, names, share, avgTotal);
  const closest = findClosestMatch(ms, names, avgTotal);
  const blowout = findBlowout(ms, names, avgTotal);
  const tight = findTightTournament(ms, avgTotal);

  // Чередуем химию с драмой: если карточек наберётся больше, чем помещается,
  // подборка всё равно останется разнообразной.
  return [bestPair?.insight, closest, chemistry, blowout, carried, tight]
    .filter((i): i is Insight => i !== null && i !== undefined)
    .slice(0, 5);
}

function findBestPair(
  pairs: Map<string, PairTally>,
  names: Map<string, string>,
): { key: string; insight: Insight } | null {
  let best: { key: string; pair: PairTally; share: number } | null = null;

  for (const [key, pair] of pairs) {
    if (pair.matches < MIN_PAIR_MATCHES || pair.of === 0) continue;
    const value = pair.points / pair.of;
    if (value < MIN_PAIR_SHARE) continue;
    if (!best || value > best.share) best = { key, pair, share: value };
  }

  if (!best) return null;

  const { pair } = best;
  const names2 = pair.ids.map((id) => names.get(id) ?? '—');
  const together = `${pair.matches} ${plural(pair.matches, 'матч', 'матча', 'матчей')} вместе`;
  const text =
    pair.wins === pair.matches
      ? `${names2[0]} и ${names2[1]} — ${together}, все выиграны, ${percent(best.share)} очков`
      : `${names2[0]} и ${names2[1]} — ${percent(best.share)} очков за ${together}`;

  return { key: best.key, insight: { id: 'best-pair', icon: '🤝', title: 'Лучшая пара', text } };
}

/**
 * Химия: пара, которая вместе играет заметно лучше, чем каждый из двоих с
 * кем-то ещё. Сравнение идёт именно с «другими партнёрами», а не со средним
 * по игроку, иначе пара соревновалась бы сама с собой.
 */
function findChemistry(
  pairs: Map<string, PairTally>,
  tallies: Map<string, Tally>,
  names: Map<string, string>,
  avgTotal: number,
  skipKey: string | undefined,
): Insight | null {
  let best: { pair: PairTally; lift: number } | null = null;

  for (const [key, pair] of pairs) {
    if (key === skipKey || pair.matches < MIN_PAIR_MATCHES || pair.of === 0) continue;

    const apart: number[] = [];
    for (const id of pair.ids) {
      const tally = tallies.get(id);
      if (!tally) continue;
      const of = tally.of - pair.of;
      if (of <= 0) continue;
      apart.push((tally.points - pair.points) / of);
    }
    // Оба должны где-то играть порознь, иначе сравнивать не с чем.
    if (apart.length < 2) continue;

    const lift = pair.points / pair.of - (apart[0] + apart[1]) / 2;
    if (!best || lift > best.lift) best = { pair, lift };
  }

  if (!best || best.lift < MIN_LIFT) return null;
  const gain = Math.round(best.lift * avgTotal);
  if (gain < MIN_LIFT_POINTS) return null;

  const [first, second] = best.pair.ids.map((id) => names.get(id) ?? '—');
  return {
    id: 'chemistry',
    icon: '⚡',
    title: 'Химия',
    text: `${first} и ${second} вместе — на ${points(gain)} за матч больше, чем с другими партнёрами`,
  };
}

/** Кто был сильнее тех, кто ему доставался. */
function findCarried(
  tallies: Map<string, Tally>,
  partners: Map<string, string[]>,
  names: Map<string, string>,
  share: (id: string) => number,
  avgTotal: number,
): Insight | null {
  let best: { id: string; lift: number } | null = null;

  for (const [id, tally] of tallies) {
    const mates = partners.get(id) ?? [];
    // Три матча и хотя бы двое разных партнёров: с одним всё решает он сам.
    if (tally.played < 3 || new Set(mates).size < 2) continue;

    const around = mates.reduce((sum, mate) => sum + share(mate), 0) / mates.length;
    const lift = share(id) - around;
    if (!best || lift > best.lift) best = { id, lift };
  }

  if (!best || best.lift < MIN_LIFT) return null;
  const gain = Math.round(best.lift * avgTotal);
  if (gain < MIN_LIFT_POINTS) return null;

  return {
    id: 'carried',
    icon: '💪',
    title: 'Кто тащил',
    text: `${names.get(best.id) ?? '—'} — в среднем на ${points(gain)} за матч результативнее своих партнёров`,
  };
}

/** Порог «близкого» матча — десятая часть разыгранного. */
function closeMargin(avgTotal: number): number {
  return Math.max(1, Math.round(avgTotal * 0.1));
}

function marginOf(m: PlayedMatch): number {
  return Math.abs(m.score1 - m.score2);
}

function scoreLine(m: PlayedMatch, names: Map<string, string>): string {
  return (
    `${teamLabel(m.team1, names)} — ${m.score1}:${m.score2} — ${teamLabel(m.team2, names)}. ` +
    `Раунд ${m.round}`
  );
}

function findClosestMatch(
  ms: PlayedMatch[],
  names: Map<string, string>,
  avgTotal: number,
): Insight | null {
  // При равной разнице интереснее поздний раунд: там она уже стоила места.
  const best = [...ms].sort(
    (a, b) => marginOf(a) - marginOf(b) || b.round - a.round || a.court - b.court,
  )[0];
  if (!best || marginOf(best) > closeMargin(avgTotal)) return null;

  return {
    id: 'closest',
    icon: marginOf(best) === 0 ? '⚖️' : '🔥',
    title: marginOf(best) === 0 ? 'Ничья' : 'Матч турнира',
    text: scoreLine(best, names),
  };
}

function findBlowout(
  ms: PlayedMatch[],
  names: Map<string, string>,
  avgTotal: number,
): Insight | null {
  const best = [...ms].sort((a, b) => marginOf(b) - marginOf(a) || a.round - b.round)[0];
  if (!best || marginOf(best) < Math.ceil(avgTotal * 0.6)) return null;

  const dry = best.score1 === 0 || best.score2 === 0;
  return {
    id: 'blowout',
    icon: dry ? '🥯' : '💥',
    title: dry ? 'Баранка' : 'Разгром',
    text: scoreLine(best, names),
  };
}

function findTightTournament(ms: PlayedMatch[], avgTotal: number): Insight | null {
  const edge = Math.max(1, Math.round(avgTotal * 0.08));
  const close = ms.filter((m) => marginOf(m) <= edge).length;
  // Один близкий матч — это «матч турнира», а не характер вечера.
  if (close < 3 || close / ms.length < 0.3) return null;

  return {
    id: 'tight',
    icon: '😬',
    title: 'Нервный турнир',
    text:
      `${close} из ${ms.length} ${plural(ms.length, 'матча', 'матчей', 'матчей')} — ` +
      `разница в ${points(edge)} и меньше`,
  };
}

// ============================================================================
// Динамика: таблица после каждого раунда
// ============================================================================

export interface RoundSnapshot {
  round: number;
  /** Таблица по всем сыгранным матчам этого раунда и предыдущих. */
  standings: Standing[];
}

/**
 * Таблица после каждого раунда, где хоть что-то сыграно. Раунд с недоигранными
 * матчами тоже попадает сюда: у досрочно завершённого турнира иначе пропал бы
 * весь его финал.
 */
export function roundHistory(players: Player[], matches: Match[]): RoundSnapshot[] {
  const ms = playedMatches(matches);
  const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round) => ({
    round,
    standings: computeStandings(
      players,
      ms.filter((m) => m.round <= round),
    ),
  }));
}

/** Место игрока в каждом срезе: 1-based, в порядке раундов. */
export function positionsById(history: RoundSnapshot[]): Map<string, number[]> {
  const tracks = new Map<string, number[]>();
  for (const snapshot of history) {
    snapshot.standings.forEach((row, index) => {
      const track = tracks.get(row.playerId) ?? [];
      track.push(index + 1);
      tracks.set(row.playerId, track);
    });
  }
  return tracks;
}

/** Меньше — и «динамики» ещё нет, есть один-два результата. */
const MIN_ROUNDS_FOR_DYNAMICS = 3;
/** Скачок по таблице, который уже не спишешь на пару очков. */
const MIN_MOVE = 3;

export function dynamicsInsights(players: Player[], matches: Match[]): Insight[] {
  const history = roundHistory(players, matches);
  if (history.length < MIN_ROUNDS_FOR_DYNAMICS) return [];

  const final = history[history.length - 1].standings;
  const winner = final[0];
  if (!winner) return [];

  const names = new Map(players.map((p) => [p.id, p.name]));
  const tracks = positionsById(history);
  const avgTotal = averageTotal(playedMatches(matches));

  return [
    findLeadStory(history, winner, names),
    findLeadChanges(history),
    findGap(final, avgTotal),
    findMove(tracks, history, names, 'up'),
    findMove(tracks, history, names, 'down'),
    findSecondWind(players, matches, names, avgTotal),
  ]
    .filter((i): i is Insight => i !== null)
    .slice(0, 6);
}

/** С какого раунда победитель занял первое место и больше его не отдавал. */
function findLeadStory(
  history: RoundSnapshot[],
  winner: Standing,
  names: Map<string, string>,
): Insight | null {
  let since = history.length - 1;
  while (since > 0 && history[since - 1].standings[0]?.playerId === winner.playerId) since--;

  const name = names.get(winner.playerId) ?? winner.name;
  if (since === 0) {
    return {
      id: 'wire-to-wire',
      icon: '👑',
      title: 'С первого раунда',
      text: `${name} — первое место после каждого раунда турнира`,
    };
  }
  if (since === history.length - 1) {
    return {
      id: 'last-round',
      icon: '⏱️',
      title: 'Развязка',
      text: `${name} — первое место только после последнего раунда`,
    };
  }
  return {
    id: 'lead-since',
    icon: '👑',
    title: 'Лидер',
    text: `${name} — первое место с ${history[since].round}-го раунда и до конца`,
  };
}

function findLeadChanges(history: RoundSnapshot[]): Insight | null {
  let changes = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].standings[0]?.playerId !== history[i - 1].standings[0]?.playerId) changes++;
  }
  if (changes < 2) return null;

  return {
    id: 'lead-changes',
    icon: '🔄',
    title: 'Борьба за первое',
    text: `Первое место менялось ${changes} ${plural(changes, 'раз', 'раза', 'раз')} за турнир`,
  };
}

function findGap(final: Standing[], avgTotal: number): Insight | null {
  const [first, second] = final;
  if (!second) return null;
  const gap = first.pointsFor - second.pointsFor;

  if (gap <= 2) {
    return {
      id: 'photo-finish',
      icon: '🎯',
      title: 'Фотофиниш',
      text:
        gap === 0
          ? `${first.name} и ${second.name} — поровну, первое место решила разница очков`
          : `${first.name} впереди ${second.name} всего на ${points(gap)}`,
    };
  }
  if (gap >= Math.round(avgTotal * 0.6)) {
    return {
      id: 'dominant',
      icon: '🏆',
      title: 'Уверенная победа',
      text: `${first.name} — ${points(gap)} отрыва от второго места`,
    };
  }
  return null;
}

/** Камбэк и спад считаются одинаково — меняется только знак. */
function findMove(
  tracks: Map<string, number[]>,
  history: RoundSnapshot[],
  names: Map<string, string>,
  direction: 'up' | 'down',
): Insight | null {
  let best: { id: string; from: number; at: number; to: number; move: number } | null = null;

  for (const [id, track] of tracks) {
    const finish = track[track.length - 1];
    // Крайняя точка ищется до финиша: иначе «движением» окажется сам финиш.
    const earlier = track.slice(0, -1);
    if (earlier.length === 0) continue;

    const peak = direction === 'up' ? Math.max(...earlier) : Math.min(...earlier);
    const move = direction === 'up' ? peak - finish : finish - peak;
    if (move < MIN_MOVE) continue;
    if (!best || move > best.move) {
      best = { id, from: peak, at: history[earlier.indexOf(peak)].round, to: finish, move };
    }
  }

  if (!best) return null;
  const name = names.get(best.id) ?? '—';
  const text = `${name}: ${best.from}-е место после ${best.at}-го раунда → ${best.to}-е в итоге`;

  return direction === 'up'
    ? { id: 'comeback', icon: '📈', title: 'Камбэк', text }
    : { id: 'slide', icon: '📉', title: 'Спад', text };
}

/** Кто прибавил во второй половине своих матчей. */
function findSecondWind(
  players: Player[],
  matches: Match[],
  names: Map<string, string>,
  avgTotal: number,
): Insight | null {
  const ms = playedMatches(matches).sort((a, b) => a.round - b.round || a.court - b.court);
  let best: { id: string; lift: number } | null = null;

  for (const player of players) {
    const own = ms.filter((m) => [...m.team1, ...m.team2].includes(player.id));
    // Меньше четырёх матчей — половины не из чего сложить.
    if (own.length < 4) continue;

    const half = Math.floor(own.length / 2);
    const shareOf = (part: PlayedMatch[]): number | null => {
      let got = 0;
      let of = 0;
      for (const m of part) {
        got += m.team1.includes(player.id) ? m.score1 : m.score2;
        of += totalOf(m);
      }
      return of > 0 ? got / of : null;
    };

    const first = shareOf(own.slice(0, half));
    const second = shareOf(own.slice(own.length - half));
    if (first === null || second === null) continue;

    const lift = second - first;
    if (!best || lift > best.lift) best = { id: player.id, lift };
  }

  if (!best || best.lift < MIN_LIFT) return null;
  const gain = Math.round(best.lift * avgTotal);
  if (gain < MIN_LIFT_POINTS) return null;

  return {
    id: 'second-wind',
    icon: '🚀',
    title: 'Второе дыхание',
    text: `${names.get(best.id) ?? '—'} во второй половине — на ${points(gain)} за матч больше, чем в первой`,
  };
}
