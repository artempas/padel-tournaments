'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import RatingChart from './RatingChart';
import ThemeToggle from './ThemeToggle';
import { TierIcon, TierSprite, tierColor } from './TierIcon';
import { plural } from '@/lib/plural';
import { CALIBRATION_MATCHES, RATING_TIERS, tierOf } from '@/lib/rating';
import type { PlayerProfile } from '@/lib/roster';

/**
 * Страница игрока.
 *
 * Отдельным экраном, а не раскрытой строкой в списке, ради двух вещей: сюда
 * ведёт постоянная ссылка (профиль можно прислать человеку), и здесь есть
 * место под график во всю ширину. Список при этом остаётся списком — в нём
 * лежит спарклайн и переход сюда.
 *
 * Выбор турнира общий у графика и у списка под ним: это один и тот же выбор,
 * показанный дважды, и разъезжаться им незачем. График удобнее пальцем, список
 * — с клавиатуры и программе чтения экрана.
 */

const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const shortFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Цвет изменения: рост — акцентом, спад — приглушённо, ноль — как текст. */
function deltaClass(value: number): string {
  if (value > 0) return 'text-accent';
  if (value < 0) return 'text-muted';
  return '';
}

export default function PlayerProfileView({
  profile,
  clubName,
}: {
  profile: PlayerProfile;
  clubName: string;
}) {
  const { player, history, names, rank, total, peak } = profile;

  const [selected, setSelected] = useState<string | null>(
    history[history.length - 1]?.tournamentId ?? null,
  );
  const row = useRef<HTMLLIElement>(null);

  // Выбор с графика попадает в список, который может быть ниже экрана: без
  // этого тап по дальней точке выглядел бы так, будто ничего не произошло.
  useEffect(() => {
    row.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const tier = tierOf(player.rating, player.matches);
  const color = tierColor(tier.id);

  /** Сколько рейтинга принёс последний турнир — то, что человек ищет первым. */
  const last = history[history.length - 1];

  /** Ближайшая ступень сверху: до неё и считается остаток. */
  const next = useMemo(() => {
    if (tier.id === 'calibration') return null;
    const above = [...RATING_TIERS]
      .reverse()
      .find((t) => t.floor !== null && t.floor > player.rating);
    return above?.floor ? { label: above.label, gap: above.floor - player.rating } : null;
  }, [tier.id, player.rating]);

  const cells: Array<[string, string]> = [
    ['Матчей', String(player.matches)],
    [
      'Побед',
      player.matches
        ? `${player.wins} · ${Math.round((player.wins / player.matches) * 100)}%`
        : '—',
    ],
    ['Разница', signed(player.diff)],
    ['Очков', String(player.pointsFor)],
    ['За матч', player.matches ? (player.pointsFor / player.matches).toFixed(1) : '—'],
    ['Пик', String(peak)],
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
      <TierSprite />
      <header className="mb-5 flex items-center gap-3">
        <Link
          href="/players"
          className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted"
          aria-label="К списку игроков"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{player.name}</h1>
          <p className="truncate text-xs text-muted">{clubName}</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="card mb-3 flex items-center gap-4 p-4">
        <TierIcon id={tier.id} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{tier.label}</p>
          <p className="text-sm text-muted">
            {tier.id === 'calibration'
              ? `ещё ${CALIBRATION_MATCHES - player.matches} ${plural(
                  CALIBRATION_MATCHES - player.matches,
                  'матч',
                  'матча',
                  'матчей',
                )} — и ступень определится`
              : next
                ? `до ступени «${next.label}» — ${next.gap}`
                : 'выше некуда'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-bold leading-none tabular-nums">{player.rating}</p>
          {last && (
            <p className={`mt-1 text-sm font-semibold tabular-nums ${deltaClass(last.delta)}`}>
              {signed(last.delta)}
            </p>
          )}
        </div>
      </div>

      {player.matches > 0 && (
        <p className="mb-4 text-sm text-muted">
          {rank}-е место по рейтингу из {total} · {player.tournaments}{' '}
          {plural(player.tournaments, 'турнир', 'турнира', 'турниров')}
        </p>
      )}

      {history.length > 0 ? (
        <section className="card mb-4 px-2 pb-2 pt-3">
          <RatingChart
            history={history}
            selected={selected}
            onSelect={setSelected}
            color={color}
          />
        </section>
      ) : (
        <div className="card mb-4 px-5 py-8 text-center text-sm text-muted">
          Ещё ни одного сыгранного матча — рисовать нечего.
        </div>
      )}

      <dl className="mb-6 grid grid-cols-3 gap-2">
        {cells.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface-2 px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {history.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            По турнирам
          </h2>
          <ul className="card divide-y divide-line/70 overflow-hidden">
            {[...history].reverse().map((point) => {
              const open = point.tournamentId === selected;
              return (
                <li key={point.tournamentId} ref={open ? row : null}>
                  <button
                    type="button"
                    onClick={() => setSelected(open ? null : point.tournamentId)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {point.tournamentName}
                      </span>
                      <span className="block text-xs text-muted">
                        {dayFormat.format(new Date(point.at))} · {point.matches.length}{' '}
                        {plural(point.matches.length, 'матч', 'матча', 'матчей')}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-muted">
                      {point.rating}
                    </span>
                    <span
                      className={`w-10 shrink-0 text-right text-sm font-semibold tabular-nums ${deltaClass(point.delta)}`}
                    >
                      {signed(point.delta)}
                    </span>
                  </button>

                  {open && (
                    <ul className="bg-ink px-3 pb-3 text-sm">
                      {point.matches.map((match, index) => (
                        <li
                          key={index}
                          className="flex items-baseline gap-2 border-t border-line/50 py-2 first:border-t-0"
                        >
                          <span className="w-12 shrink-0 font-semibold tabular-nums">
                            {match.scoreFor}:{match.scoreAgainst}
                          </span>
                          <span className="min-w-0 flex-1 text-xs text-muted">
                            с {names[match.partnerId] ?? '—'} против{' '}
                            {match.opponentIds.map((id) => names[id] ?? '—').join(' и ')}
                          </span>
                          <span
                            className={`shrink-0 text-xs font-semibold tabular-nums ${deltaClass(match.delta)}`}
                          >
                            {signed(match.delta)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {player.lastPlayedAt && (
        <p className="mt-4 text-xs text-muted">
          Последний матч — {shortFormat.format(new Date(player.lastPlayedAt))}
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">
        График показывает рейтинг на конец каждого турнира — так, каким он был
        тогда. Ничего не хранится: и он, и итоговое число считаются прогоном по
        всей истории клуба, поэтому исправленный задним числом счёт
        пересчитывает и кривую. Всё считается по турнирам клуба «{clubName}»: тот
        же человек в другом клубе — другой игрок со своим счётом.
      </p>
    </main>
  );
}
