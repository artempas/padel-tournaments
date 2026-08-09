'use client';

import { useEffect } from 'react';
import { TierIcon } from './TierIcon';
import {
  CALIBRATION_MATCHES,
  expectedShare,
  matchRatings,
  parScore,
  RATING_TIERS,
  START_RATING,
  type Rating,
} from '@/lib/rating';

/**
 * «Как работает рейтинг» — длинное объяснение с примерами.
 *
 * Все числа в примерах не написаны руками, а посчитаны тем же `matchRatings`,
 * которым живёт приложение. Это единственный способ, при котором объяснение не
 * может соврать: поправят константы — поменяются и примеры. Пересказ формулы
 * своими числами разошёлся бы с кодом на первой же правке.
 *
 * Шторкой, а не отдельной страницей: профиль игрока — то место, откуда вопрос
 * возникает, и возвращаться после ответа надо туда же.
 */

/** Норма матча в примерах. Та же, что стоит в турнирах по умолчанию. */
const POINTS = 16;

/** Опыт «за тридцать»: K минимальный, и примеры не зависят от новичковой фазы. */
const VETERAN = 50;

function seed(ratings: number[], matches: number): Array<[string, Rating]> {
  return ratings.map((rating, i) => [`p${i}`, { rating, matches }]);
}

/**
 * Прогоняет один матч через настоящий движок и отдаёт, насколько сдвинулся
 * рейтинг игрока из первой пары.
 */
function delta(
  teamA: [number, number],
  teamB: [number, number],
  scoreA: number,
  matches = VETERAN,
): number {
  const [snapshot] = matchRatings(
    [{ teamA: ['p0', 'p1'], teamB: ['p2', 'p3'], scoreA, scoreB: POINTS - scoreA }],
    seed([teamA[0], teamA[1], teamB[0], teamB[1]], matches),
  );
  return snapshot?.teamA.players[0].delta ?? 0;
}

/** Счёт, который шкала считает ожидаемым при таком разрыве рейтингов. */
function parAt(gap: number): [number, number] {
  return parScore(expectedShare(START_RATING + gap, START_RATING), POINTS);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function deltaClass(value: number): string {
  if (value > 0) return 'text-accent';
  if (value < 0) return 'text-muted';
  return 'text-muted';
}

/** Разрывы для таблицы ожиданий — от «поровну» до «пропасть». */
const GAPS = [0, 20, 40, 60, 86];

interface Example {
  title: string;
  lead: string;
  teamA: [number, number];
  teamB: [number, number];
  /**
   * Счета от разгрома до разгрома. Подобраны так, чтобы каждая строка давала
   * своё число: соседние счета округляются в одно и то же, и таблица из
   * одинаковых значений выглядела бы сломанной.
   */
  scores: number[];
  tail: string;
}

const EXAMPLES: Example[] = [
  {
    title: 'Соперники равны',
    lead: 'Обе пары по 100. Ожидание — поровну, 8:8, поэтому в плюс уводит любая победа, и чем крупнее, тем сильнее.',
    teamA: [100, 100],
    teamB: [100, 100],
    scores: [16, 13, 10, 8, 6, 3],
    tail: 'Ничья не двигает никого: так и было предсказано.',
  },
  {
    title: 'Вы фаворит',
    lead: 'Ваша пара 140, соперники 100. Разрыв 40 — от вас ждут победы 10:6. Именно с этим и сравнивается счёт, а не с фактом победы.',
    teamA: [140, 140],
    teamB: [100, 100],
    scores: [16, 13, 10, 9, 6, 3],
    tail: 'Отсюда главное: 9:7 — это победа и одновременно минус. Вы выиграли, но слабее, чем от вас ждали.',
  },
];

export default function RatingExplainerSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Один и тот же игрок 120 с сильным и со слабым партнёром против тех же
  // соперников: видно, что награда зависит от пары, а не от вас одного.
  const withStrong = delta([120, 180], [100, 100], 13);
  const withWeak = delta([120, 60], [100, 100], 13);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Как работает рейтинг"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />

        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Как работает рейтинг</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-2 py-1 text-muted"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <section className="mb-6">
          <p className="text-sm leading-relaxed">
            Рейтинг сравнивает <b>не победу с поражением, а счёт с ожидаемым</b>. Матч играется до
            фиксированной суммы очков на двоих, поэтому счёт сам по себе уже говорит, насколько
            уверенной была игра: 12:4 — это 0.75 от матча, 9:7 — всего 0.5625.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Дальше это число сравнивается с тем, чего от вашей пары ждали, исходя из рейтингов
            всех четверых. Сыграли лучше ожидаемого — рейтинг вырос, хуже — упал. Поэтому крупная
            победа над сильными стоит дорого, а скромная над слабыми может увести в минус.
          </p>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Чего от вас ждут</h3>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Сила пары — среднее рейтингов двоих. Разрыв между парами превращается в ожидаемый
            счёт:
          </p>
          <ul className="overflow-hidden rounded-xl border border-line">
            <li className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2 text-xs uppercase tracking-wide text-muted">
              <span>Вы сильнее на</span>
              <span>Ждут счёта</span>
            </li>
            {GAPS.map((gap) => {
              const [forA, against] = parAt(gap);
              return (
                <li
                  key={gap}
                  className="flex items-center justify-between border-b border-line/70 px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="tabular-nums">{gap === 0 ? 'ничего' : gap}</span>
                  <span className="font-semibold tabular-nums">
                    {forA}:{against}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Ровно этот счёт оставит рейтинг на месте. Всё выше — плюс, всё ниже — минус.
          </p>
        </section>

        {EXAMPLES.map((example) => (
          <section key={example.title} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold">{example.title}</h3>
            <p className="mb-3 text-sm leading-relaxed text-muted">{example.lead}</p>

            <ul className="overflow-hidden rounded-xl border border-line">
              <li className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2 text-xs uppercase tracking-wide text-muted">
                <span>Счёт</span>
                <span>Рейтинг</span>
              </li>
              {example.scores.map((scoreA) => {
                const value = delta(example.teamA, example.teamB, scoreA);
                return (
                  <li
                    key={scoreA}
                    className="flex items-center justify-between border-b border-line/70 px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="font-semibold tabular-nums">
                      {scoreA}:{POINTS - scoreA}
                    </span>
                    <span className={`font-semibold tabular-nums ${deltaClass(value)}`}>
                      {signed(value)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-muted">{example.tail}</p>
          </section>
        ))}

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Партнёр тоже считается</h3>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Вы — 120, соперники — по 100, счёт в обоих случаях 13:3. Меняется только партнёр:
          </p>
          <ul className="overflow-hidden rounded-xl border border-line">
            {[
              ['Партнёр 180 — пара сильнее всех, победа ожидаема', withStrong],
              ['Партнёр 60 — от вашей пары такого не ждали', withWeak],
            ].map(([label, value]) => (
              <li
                key={String(label)}
                className="flex items-center justify-between gap-3 border-b border-line/70 px-3 py-2 text-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-xs text-muted">{label}</span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${deltaClass(Number(value))}`}
                >
                  {signed(Number(value))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Один и тот же счёт, разная награда. Играть со слабым партнёром против равных
            соперников — самый выгодный расклад, и это честно: вытащить такой матч труднее.
          </p>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Насколько быстро он меняется</h3>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Шаг зависит от того, сколько вы уже сыграли. Пока матчей мало, рейтинг ищет ваше
            место крупными шагами; потом успокаивается, и один неудачный вечер перестаёт всё
            перечёркивать.
          </p>
          <ul className="overflow-hidden rounded-xl border border-line">
            <li className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2 text-xs uppercase tracking-wide text-muted">
              <span>Опыт</span>
              <span>16:0 у равных даст</span>
            </li>
            {[
              [`Первые ${CALIBRATION_MATCHES} матчей`, 0],
              ['До 30 матчей', CALIBRATION_MATCHES],
              ['Дальше', 30],
            ].map(([label, played]) => (
              <li
                key={String(label)}
                className="flex items-center justify-between border-b border-line/70 px-3 py-2 text-sm last:border-b-0"
              >
                <span className="text-muted">{label}</span>
                <span className="font-semibold tabular-nums text-accent">
                  {signed(delta([100, 100], [100, 100], POINTS, Number(played)))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Это потолок: всухую и вопреки ожиданиям. Обычный матч двигает рейтинг на единицы, зато
            их за вечер семь. Примеры выше посчитаны для опытного игрока.
          </p>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Ступени</h3>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Все начинают со {START_RATING}. Первые {CALIBRATION_MATCHES} матчей вместо ступени
            стоит вопросительный знак: рейтинг новичка за вечер гуляет на пол-шкалы, и вешать на
            него ступень значило бы соврать. Само число видно сразу.
          </p>
          <ul className="overflow-hidden rounded-xl border border-line">
            {RATING_TIERS.map((t, i, all) => (
              <li
                key={t.id}
                className="flex items-center gap-2 border-b border-line/70 px-3 py-2 text-sm last:border-b-0"
              >
                <TierIcon id={t.id} className="h-6 w-6" />
                <span className="flex-1 font-medium">{t.label}</span>
                <span className="tabular-nums text-muted">
                  {/* У нижней ступени порога нет — её границу задаёт соседняя сверху. */}
                  {t.floor === null ? `ниже ${all[i - 1].floor}` : `${t.floor} и выше`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-2">
          <h3 className="mb-2 text-sm font-semibold">Чего рейтинг не делает</h3>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            <li>
              <b className="text-text">Не хранится.</b> Считается заново по всей истории клуба при
              каждом открытии. Поэтому исправленный задним числом счёт пересчитывает и рейтинг, и
              график — разойтись им негде.
            </li>
            <li>
              <b className="text-text">Не переносится между клубами.</b> Тот же человек в другом
              клубе — другой игрок со своим счётом: сравнивать числа клубов, которые между собой
              не играют, бессмысленно.
            </li>
            <li>
              <b className="text-text">Не награждает за количество.</b> Сыграть больше матчей само
              по себе рейтинг не поднимает — только играть лучше ожидаемого.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
