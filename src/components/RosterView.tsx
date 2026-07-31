'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import { useOptimisticState } from '@/lib/optimistic';
import { TierIcon, TierSprite } from './TierIcon';
import { plural } from '@/lib/plural';
import { CALIBRATION_MATCHES, RATING_TIERS, tierOf, type TierId } from '@/lib/rating';
import { request } from '@/lib/request';
import type { RosterStat } from '@/lib/roster';

/**
 * Классы ступеней записаны целиком, а не собраны из id: Tailwind ищет имена
 * классов по исходнику текстом, и `bg-${id}` он не увидит.
 */
const TIER_STYLE: Record<TierId, string> = {
  // Калибровка нарочно без заливки: пустая плашка читается как «ступени ещё
  // нет», а не как самая нижняя из них. С серебром её иначе путают — оно тоже
  // серое.
  calibration: 'text-muted ring-1 ring-inset ring-line',
  bronze: 'bg-bronze/20 text-bronze ring-1 ring-inset ring-bronze/40',
  silver: 'bg-silver/20 text-silver ring-1 ring-inset ring-silver/40',
  gold: 'bg-gold/20 text-gold ring-1 ring-inset ring-gold/40',
  platinum: 'bg-platinum/20 text-platinum ring-1 ring-inset ring-platinum/40',
  diamond: 'bg-diamond/20 text-diamond ring-1 ring-inset ring-diamond/40',
};

type Sort = 'points' | 'rating' | 'matches' | 'name';

// Dative case, so each option reads on from the "Сортировать по" label.
const SORTS: Array<[Sort, string]> = [
  ['points', 'Очкам'],
  ['rating', 'Рейтингу'],
  ['matches', 'Матчам'],
  ['name', 'Имени'],
];

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export default function RosterView({ initial }: { initial: RosterStat[] }) {
  const router = useRouter();
  const { value: players, error, mutate } = useOptimisticState(initial);
  const [sort, setSort] = useState<Sort>('points');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...players];
    if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else if (sort === 'matches')
      copy.sort((a, b) => b.matches - a.matches || b.pointsFor - a.pointsFor);
    else if (sort === 'rating') copy.sort((a, b) => b.rating - a.rating || b.matches - a.matches);
    else copy.sort((a, b) => b.pointsFor - a.pointsFor || b.diff - a.diff);
    return copy;
  }, [players, sort]);

  /** Строка пропадает по клику; если сервер откажет, игрок вернётся на место. */
  function remove(person: RosterStat) {
    setPendingDelete(null);
    setExpandedId(null);

    mutate({
      next: (list) => list.filter((p) => p.id !== person.id),
      // Место в списке задаёт сортировка, так что возвращать в конец достаточно.
      undo: (list) => (list.some((p) => p.id === person.id) ? list : [...list, person]),
      send: async () => {
        await request(`/api/roster/${person.id}`, { method: 'DELETE' });
        router.refresh();
      },
      message: 'Не удалось убрать игрока из списка',
      offline: 'Нет сети — убрать игрока можно только со связью',
    });
  }

  const totals = useMemo(
    () => ({
      people: players.length,
      matches: players.reduce((sum, p) => sum + p.matches, 0) / 4,
      points: players.reduce((sum, p) => sum + p.pointsFor, 0),
    }),
    [players],
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
      <TierSprite />
      <header className="mb-5 flex items-center gap-3">
        <Link
          href="/tournaments"
          className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted"
          aria-label="К списку турниров"
        >
          ←
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Игроки</h1>
        <ThemeToggle />
      </header>

      {players.length === 0 ? (
        <div className="card px-5 py-12 text-center">
          <div className="mb-3 text-4xl">👥</div>
          <h2 className="text-lg font-semibold">Пока никого нет</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
            Игроки сохраняются автоматически, когда вы создаёте турнир.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            {totals.people}{' '}
            {totals.people % 10 === 1 && totals.people % 100 !== 11 ? 'игрок' : 'игроков'} ·{' '}
            {totals.points} очков за всё время
          </p>

          {/* `htmlFor` rather than wrapping the select: a wrapping label would
              fold every option's text into the control's accessible name. */}
          <div className="mb-4 flex items-center gap-3">
            <label htmlFor="roster-sort" className="shrink-0 text-sm font-medium text-muted">
              Сортировать по
            </label>
            <div className="relative min-w-0 flex-1">
              {/* A native select opens the OS picker, which beats a custom
                  menu on a phone. */}
              <select
                id="roster-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="tap w-full appearance-none rounded-xl border border-line bg-ink py-2 pl-4 pr-10 font-semibold text-text focus:border-accent focus:outline-none"
              >
                {SORTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-muted"
              >
                ▾
              </span>
            </div>
          </div>

          {error && (
            <p className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              {error}
            </p>
          )}

          <div className="card overflow-hidden">
            {/* Матчи стоят вплотную к рейтингу намеренно: 1043 после шести
                матчей и 1043 после двух сотен — разные числа, и видно это
                должно быть без разворачивания строки. */}
            <div className="grid grid-cols-[1.5rem_1fr_3.75rem_2.75rem_2.25rem] items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Игрок</span>
              <span className="text-right">Рейтинг</span>
              <span className="text-right">Очки</span>
              <span className="text-right">Матчи</span>
            </div>
            <ul className="divide-y divide-line/70">
              {sorted.map((person, index) => {
                const open = expandedId === person.id;
                const tier = tierOf(person.rating, person.matches);
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(open ? null : person.id);
                        setPendingDelete(null);
                      }}
                      aria-expanded={open}
                      className="grid w-full grid-cols-[1.5rem_1fr_3.75rem_2.75rem_2.25rem] items-center gap-1.5 px-3 py-3 text-left"
                    >
                      <span className="text-sm font-bold tabular-nums text-muted">
                        {index + 1}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium">{person.name}</span>
                      {/* Ступень и число живут в одной плашке: цвет виден с
                          расстояния, число — когда в него вглядываются. */}
                      <span
                        className={`flex w-full items-center justify-center gap-0.5 rounded-md px-1 py-0.5 text-sm font-bold tabular-nums ${TIER_STYLE[tier.id]}`}
                        title={`${tier.label} · рейтинг ${person.rating}`}
                      >
                        <TierIcon id={tier.id} className="h-4 w-4" />
                        {person.rating}
                      </span>
                      <span className="text-right text-sm font-semibold tabular-nums">
                        {person.pointsFor}
                      </span>
                      <span className="text-right text-sm tabular-nums text-muted">
                        {person.matches}
                      </span>
                    </button>

                    {open && (
                      <div className="bg-ink px-3 pb-4 pt-1">
                        <p className="mb-3 flex items-center gap-2 text-sm">
                          <span
                            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold ${TIER_STYLE[tier.id]}`}
                          >
                            <TierIcon id={tier.id} className="h-5 w-5" />
                            {tier.label}
                          </span>
                          {tier.id === 'calibration' && (
                            <span className="text-xs text-muted">
                              ещё {CALIBRATION_MATCHES - person.matches}{' '}
                              {plural(
                                CALIBRATION_MATCHES - person.matches,
                                'матч',
                                'матча',
                                'матчей',
                              )}{' '}
                              — и ступень определится
                            </span>
                          )}
                        </p>

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                          <div>
                            <dt className="text-xs text-muted">Турниров</dt>
                            <dd className="font-semibold tabular-nums">{person.tournaments}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted">Побед</dt>
                            <dd className="font-semibold tabular-nums">
                              {person.wins}
                              {person.matches > 0 && (
                                <span className="ml-1 font-normal text-muted">
                                  ({Math.round((person.wins / person.matches) * 100)}%)
                                </span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted">Разница</dt>
                            <dd className="font-semibold tabular-nums">
                              {person.diff > 0 ? `+${person.diff}` : person.diff}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted">В среднем</dt>
                            <dd className="font-semibold tabular-nums">
                              {person.matches
                                ? (person.pointsFor / person.matches).toFixed(1)
                                : '—'}
                            </dd>
                          </div>
                        </dl>

                        {person.lastPlayedAt && (
                          <p className="mt-3 text-xs text-muted">
                            Последний матч — {dateFormat.format(new Date(person.lastPlayedAt))}
                          </p>
                        )}

                        {pendingDelete === person.id ? (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => remove(person)}
                              className="tap flex-1 rounded-xl bg-warn px-4 text-sm font-bold text-ink"
                            >
                              Убрать из списка
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(null)}
                              className="tap flex-1 rounded-xl border border-line px-4 text-sm font-medium text-muted"
                            >
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDelete(person.id)}
                            className="mt-3 text-xs font-medium text-muted underline underline-offset-2"
                          >
                            Убрать из списка
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            Очки — сумма всех очков, набранных игроком во всех турнирах. Рейтинг растёт за
            результаты лучше ожидаемых и падает за худшие, поэтому крупная победа над сильными
            стоит дороже, чем над слабыми. Все начинают со 100, и первые {CALIBRATION_MATCHES}{' '}
            матчей вместо ступени стоит вопросительный знак — столько рейтинг ещё пляшет. Удаление
            из списка не трогает сыгранные турниры: результаты в них останутся, игрок просто
            перестанет предлагаться при создании нового.
          </p>

          {/* Легенда читает те же пороги, что и tierOf: разойтись с таблицей
              ей поэтому нечем. */}
          <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
            {[...RATING_TIERS].reverse().map((t, i, all) => (
              <li key={t.id} className="flex items-center gap-1">
                <TierIcon id={t.id} className="h-4 w-4" />
                {t.label}
                <span className="tabular-nums opacity-60">
                  {/* У нижней ступени порога нет — её границу задаёт следующая. */}
                  {t.floor === null ? `< ${all[i + 1].floor}` : `${t.floor}+`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
