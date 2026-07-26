'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import type { RosterStat } from '@/lib/roster';

type Sort = 'points' | 'matches' | 'name';

// Dative case, so each option reads on from the "Сортировать по" label.
const SORTS: Array<[Sort, string]> = [
  ['points', 'Очкам'],
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
  const [players, setPlayers] = useState(initial);
  const [sort, setSort] = useState<Sort>('points');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...players];
    if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else if (sort === 'matches')
      copy.sort((a, b) => b.matches - a.matches || b.pointsFor - a.pointsFor);
    else copy.sort((a, b) => b.pointsFor - a.pointsFor || b.diff - a.diff);
    return copy;
  }, [players, sort]);

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/roster/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setPlayers((current) => current.filter((p) => p.id !== id));
      setPendingDelete(null);
      setExpandedId(null);
      router.refresh();
    } else {
      setError('Не удалось удалить игрока');
    }
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
            <div className="grid grid-cols-[2rem_1fr_3.5rem_2.75rem] items-center gap-2 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Игрок</span>
              <span className="text-right">Очки</span>
              <span className="text-right">Матчи</span>
            </div>
            <ul className="divide-y divide-line/70">
              {sorted.map((person, index) => {
                const open = expandedId === person.id;
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(open ? null : person.id);
                        setPendingDelete(null);
                      }}
                      aria-expanded={open}
                      className="grid w-full grid-cols-[2rem_1fr_3.5rem_2.75rem] items-center gap-2 px-3 py-3 text-left"
                    >
                      <span className="text-sm font-bold tabular-nums text-muted">
                        {index + 1}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium">{person.name}</span>
                      <span className="text-right text-base font-bold tabular-nums">
                        {person.pointsFor}
                      </span>
                      <span className="text-right text-sm tabular-nums text-muted">
                        {person.matches}
                      </span>
                    </button>

                    {open && (
                      <div className="bg-ink px-3 pb-4 pt-1">
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
                              onClick={() => remove(person.id)}
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
            Очки — сумма всех очков, набранных игроком во всех турнирах. Удаление из списка не
            трогает сыгранные турниры: результаты в них останутся, игрок просто перестанет
            предлагаться при создании нового.
          </p>
        </>
      )}
    </main>
  );
}
