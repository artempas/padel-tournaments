/**
 * Клубный рейтинг — Elo, где результатом матча служит доля набранных очков.
 *
 * Матч играется до фиксированной суммы очков на двоих, поэтому счёт уже
 * нормирован: 12:4 — это 0.75, ровно та величина, которую Elo ждёт на вход.
 * В шахматном рейтинге результат приходится грубо схлопывать в 1/0.5/0; здесь
 * этого делать не нужно, и разгром перестаёт быть тем же самым, что победа на
 * последнем мяче.
 *
 * Знаменателем служит сам счёт, а не норма турнира: результат тогда
 * самодостаточен, вечер до 16 очков сравним с вечером до 32, и модулю не нужно
 * знать ни про `matches.points_sum`, ни про его NULL у старых строк.
 *
 * Ничего не хранится. Рейтинг — функция от истории, и считается по ней целиком
 * при каждом чтении: правка счёта задним числом пересчитывает всё сама, и
 * рассинхронизироваться нечему — как и со статусом турнира.
 */

/** Стартовый рейтинг: с него начинает каждый, кого ещё не видели. */
export const START_RATING = 100;

/**
 * Цена разницы рейтингов — она же ширина всей шкалы.
 *
 * Три числа ниже подобраны вместе, и порознь их менять бессмысленно. Величина
 * шага (K) от стартового рейтинга не зависит вовсе, а расстояние, на которое
 * игроки в итоге расходятся, задаёт SCALE: равновесие наступает там, где
 * ожидание совпало с реальной долей очков, то есть на разрыве
 * SCALE × log10(доля / (1 − доля)).
 *
 * При 180 клуб за сезон расселяется примерно по 40…160 — крайние отличаются
 * вчетверо, и разница видна без вглядывания в четвёртый знак. Ниже 0 при этом
 * не уходит никто: на прогоне в 700 матчей с нарочно перекошенным составом
 * худший остановился на 37.
 */
const SCALE = 180;

/**
 * Пока матчей меньше этого, рейтинг ещё пляшет, и тир не показывается — вместо
 * него вопросительный знак. Граница та же, что у самого большого K: ровно
 * столько же длится ускоренная сходимость новичка.
 */
export const CALIBRATION_MATCHES = 10;

/** Матч глазами рейтинга: кто с кем и с каким счётом. */
export interface RatedMatch {
  teamA: readonly [string, string];
  teamB: readonly [string, string];
  scoreA: number;
  scoreB: number;
}

export interface Rating {
  /** Дробный: округляется только при показе, чтобы копейки не терялись. */
  rating: number;
  matches: number;
}

/** Игрок на момент, когда матч доигран. Уже в целых — как на экране. */
export interface PlayerRating {
  id: string;
  /** Каким рейтинг стал по завершении этого матча. */
  rating: number;
  /** Насколько его сдвинул этот матч. */
  delta: number;
}

/** Пара на тот же момент: двое и их среднее — та самая сила пары из расчёта. */
export interface TeamRating {
  players: [PlayerRating, PlayerRating];
  rating: number;
  delta: number;
}

export interface MatchRating {
  teamA: TeamRating;
  teamB: TeamRating;
}

/**
 * Насколько сильно матч двигает рейтинг. Новичок за один вечер (в американо
 * это семь матчей) находит своё место, ветеран не скачет от одного неудачного
 * турнира.
 */
function kFactor(matches: number): number {
  if (matches < CALIBRATION_MATCHES) return 18;
  if (matches < 30) return 14;
  return 11;
}

/**
 * Снимок пары: что стало с каждым и со средним по двоим.
 *
 * Дельта считается по разнице показанных чисел, а не сырых: тогда изменения
 * матчей складываются ровно в изменение за турнир, без расхождения в единицу
 * там, где копейки набежали в целое.
 */
function snapshot(
  ids: readonly [string, string],
  before: readonly [number, number],
  rows: Rating[],
): TeamRating {
  const meanBefore = (before[0] + before[1]) / 2;
  const meanAfter = (rows[0].rating + rows[1].rating) / 2;

  return {
    players: [0, 1].map((i) => ({
      id: ids[i],
      rating: Math.round(rows[i].rating),
      delta: Math.round(rows[i].rating) - Math.round(before[i]),
    })) as [PlayerRating, PlayerRating],
    rating: Math.round(meanAfter),
    delta: Math.round(meanAfter) - Math.round(meanBefore),
  };
}

/**
 * Прогоняет матчи в том порядке, в каком их сыграли, меняя `table` по пути, и
 * отдаёт снимок после каждого из них.
 *
 * Генератор, а не массив: рейтинг клуба считается по всей его истории, и
 * снимки там никому не нужны — так они и не копятся. `null` — у матча, который
 * сыгранным не считается.
 */
function* replay(
  matches: Iterable<RatedMatch>,
  table: Map<string, Rating>,
): Generator<MatchRating | null> {
  function get(id: string): Rating {
    let row = table.get(id);
    if (!row) table.set(id, (row = { rating: START_RATING, matches: 0 }));
    return row;
  }

  for (const match of matches) {
    const total = match.scoreA + match.scoreB;
    // Несыгранный матч сюда попасть не должен, но 0:0 не нормируется, и
    // деление на ноль — худший способ об этом узнать.
    if (total <= 0) {
      yield null;
      continue;
    }

    const a = match.teamA.map(get);
    const b = match.teamB.map(get);

    const beforeA: [number, number] = [a[0].rating, a[1].rating];
    const beforeB: [number, number] = [b[0].rating, b[1].rating];

    // Сила пары — среднее двоих: партнёр слабее делает победу ожидаемее для
    // соперника, и рейтинг сам это учитывает.
    const ratingA = (beforeA[0] + beforeA[1]) / 2;
    const ratingB = (beforeB[0] + beforeB[1]) / 2;

    const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / SCALE));
    const surplus = match.scoreA / total - expected;

    // Все четыре дельты считаются от рейтингов до матча, поэтому порядок
    // обхода четвёрки ни на что не влияет. Сумма изменений строго нулевая
    // только при равных K: у новичка коэффициент выше, и его матч слегка
    // подкачивает рейтинг в клуб. Это цена быстрой сходимости новичков, и она
    // того стоит — иначе первые вечера рейтинг не значил бы ничего.
    for (const p of a) p.rating += kFactor(p.matches) * surplus;
    for (const p of b) p.rating -= kFactor(p.matches) * surplus;
    for (const p of [...a, ...b]) p.matches++;

    yield {
      teamA: snapshot(match.teamA, beforeA, a),
      teamB: snapshot(match.teamB, beforeB, b),
    };
  }
}

/** Стартовое состояние прогона. Копия: чужую таблицу расчёт не портит. */
function seed(initial?: Iterable<readonly [string, Rating]>): Map<string, Rating> {
  const table = new Map<string, Rating>();
  for (const [id, r] of initial ?? []) table.set(id, { ...r });
  return table;
}

/**
 * Прогоняет матчи в том порядке, в каком их сыграли, и возвращает рейтинг
 * каждого встреченного игрока. Порядок задаёт вызывающий: Elo путезависим,
 * и решать, что за чем шло, — не дело этой функции.
 *
 * `initial` позволяет продолжить с известного состояния: так считается вклад
 * одного турнира — берётся рейтинг на его начало и прогоняются только его
 * матчи.
 */
export function computeRatings(
  matches: Iterable<RatedMatch>,
  initial?: Iterable<readonly [string, Rating]>,
): Map<string, Rating> {
  const table = seed(initial);
  const run = replay(matches, table);
  while (!run.next().done) {
    // Прогон нужен целиком, а его снимки — нет: здесь важна только таблица,
    // которую он заполняет по дороге.
  }
  return table;
}

/**
 * Рейтинг четвёрки в каждом матче — такой, каким он стал на момент, когда матч
 * доиграли. Не сегодняшний: следующие матчи этих людей на снимок не влияют,
 * поэтому карточка сыгранного матча показывает то, что было тогда.
 *
 * Хранить снимки не нужно ровно по той же причине, по какой не хранится сам
 * рейтинг: он — функция от истории, и прогон по ней восстанавливает состояние
 * на любой её момент. Поправленный задним числом счёт при этом пересчитывает и
 * снимки, а записанное в базу число разошлось бы с историей молча.
 *
 * Ответ идёт матч в матч с тем, что подали на вход: `null` стоит там, где
 * рейтингу считать нечего (0:0), — иначе места бы разъехались.
 */
export function matchRatings(
  matches: Iterable<RatedMatch>,
  initial?: Iterable<readonly [string, Rating]>,
): Array<MatchRating | null> {
  return [...replay(matches, seed(initial))];
}

/** Матч с пометкой турнира, в котором его сыграли. */
export interface PlayedMatch extends RatedMatch {
  tournamentId: string;
  tournamentName: string;
  /** ISO-дата турнира — та же ось, по которой упорядочена вся история. */
  at: string;
}

/** Матч глазами одного его участника. */
export interface RatingMatch {
  /** Каким стал рейтинг после этого матча. */
  rating: number;
  delta: number;
  scoreFor: number;
  scoreAgainst: number;
  partnerId: string;
  opponentIds: [string, string];
}

/** Турнир в истории игрока: рейтинг на его конец и матчи, из которых он сложился. */
export interface RatingPoint {
  tournamentId: string;
  tournamentName: string;
  at: string;
  rating: number;
  delta: number;
  matches: RatingMatch[];
}

/**
 * История рейтинга каждого игрока: точка на турнир, внутри неё — матчи.
 *
 * Тот же прогон, что и `computeRatings`, только снимки не выбрасываются, а
 * раскладываются по людям. Поэтому график не может разойтись с числом в списке:
 * последняя точка — это оно и есть.
 *
 * Точка на турнир, а не на матч: внутри вечера рейтинг пляшет по десятку раз, и
 * на ширине телефона это шум. Матчи никуда не деваются — они внутри точки.
 *
 * Дельта турнира — сумма дельт его матчей, и складывается она ровно в разницу
 * показанных рейтингов: каждая считается по округлённым числам (см. `snapshot`),
 * поэтому промежуточные значения в сумме сокращаются.
 */
export function ratingHistory(matches: readonly PlayedMatch[]): Map<string, RatingPoint[]> {
  const byPerson = new Map<string, RatingPoint[]>();
  const snapshots = matchRatings(matches);

  matches.forEach((match, index) => {
    const snapshot = snapshots[index];
    // null стоит там, где рейтингу считать нечего (0:0).
    if (!snapshot) return;

    const sides = [
      { team: snapshot.teamA, foes: match.teamB, got: match.scoreA, lost: match.scoreB },
      { team: snapshot.teamB, foes: match.teamA, got: match.scoreB, lost: match.scoreA },
    ];

    for (const side of sides) {
      side.team.players.forEach((player, slot) => {
        let points = byPerson.get(player.id);
        if (!points) byPerson.set(player.id, (points = []));

        let point = points[points.length - 1];
        if (!point || point.tournamentId !== match.tournamentId) {
          points.push(
            (point = {
              tournamentId: match.tournamentId,
              tournamentName: match.tournamentName,
              at: match.at,
              rating: player.rating,
              delta: 0,
              matches: [],
            }),
          );
        }

        point.matches.push({
          rating: player.rating,
          delta: player.delta,
          scoreFor: side.got,
          scoreAgainst: side.lost,
          partnerId: side.team.players[1 - slot].id,
          opponentIds: [side.foes[0], side.foes[1]],
        });
        point.rating = player.rating;
        point.delta += player.delta;
      });
    }
  });

  return byPerson;
}

export type TierId = 'calibration' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface Tier {
  id: TierId;
  label: string;
  /** С какого рейтинга начинается; у калибровки границы нет. */
  floor: number | null;
}

/**
 * Пороги подобраны по тому, куда рейтинг реально расходится (см. SCALE), а не
 * по круглым числам: за сезон клуб растягивается примерно на 40…160, и на этом
 * отрезке заняты все пять ступеней.
 *
 * Серебро шире соседей, и намеренно: это ступень «как все», на ней стоит старт
 * и толчётся середина клуба. Будь она такой же узкой, средний игрок прыгал бы
 * между серебром и золотом от одного удачного вечера.
 */
export const RATING_TIERS: Tier[] = [
  { id: 'diamond', label: 'Алмаз', floor: 150 },
  { id: 'platinum', label: 'Платина', floor: 130 },
  { id: 'gold', label: 'Золото', floor: 110 },
  { id: 'silver', label: 'Серебро', floor: 80 },
  { id: 'bronze', label: 'Бронза', floor: null },
];

const CALIBRATION: Tier = { id: 'calibration', label: 'Калибровка', floor: null };

/**
 * Ступень игрока. Пока матчей мало, ступени нет: рейтинг новичка за вечер
 * гуляет на пол-шкалы, и повесить на него «бронзу» значило бы соврать.
 */
export function tierOf(rating: number, matches: number): Tier {
  if (matches < CALIBRATION_MATCHES) return CALIBRATION;

  // Округление здесь, а не у вызывающего: рейтинг внутри дробный, а на экране
  // всегда целый. Считай ступень от дробного — и 109.6 покажется как «110» с
  // серебром, ровно на пороге золота. Так значок и число разойтись не могут.
  const shown = Math.round(rating);
  return RATING_TIERS.find((t) => t.floor === null || shown >= t.floor) ?? CALIBRATION;
}
