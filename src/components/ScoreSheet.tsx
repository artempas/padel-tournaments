'use client';

import { useEffect, useState } from 'react';
import type { Match, Player } from '@/lib/types';

interface Props {
  match: Match;
  playersById: Map<string, Player>;
  pointsPerMatch: number;
  /** Счёт сохраняется в очередь, а не на сервер, поэтому шторка не ждёт: она
   *  закрывается тем же кликом, каким уходит запрос. */
  onSave: (score1: number, score2: number) => void;
  onClear: () => void;
  onClose: () => void;
}

function teamName(ids: [string, string], playersById: Map<string, Player>): string {
  return ids.map((id) => playersById.get(id)?.name ?? '—').join(' / ');
}

export default function ScoreSheet({
  match,
  playersById,
  pointsPerMatch,
  onSave,
  onClear,
  onClose,
}: Props) {
  // Only the first team's score is state — the second is whatever is left of
  // the fixed total, which is exactly the tournament rule.
  const [score1, setScore1] = useState(match.score1 ?? Math.floor(pointsPerMatch / 2));
  const score2 = pointsPerMatch - score1;

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

  const sides = [
    { label: teamName(match.team1, playersById), score: score1, delta: 1 },
    { label: teamName(match.team2, playersById), score: score2, delta: -1 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Внести счёт"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />

        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Раунд {match.round} · Корт {match.court}
          </h2>
          <button type="button" onClick={onClose} className="px-2 py-1 text-muted" aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p className="mb-5 text-sm text-muted">Матч играется до {pointsPerMatch} очков на двоих.</p>

        <div className="flex flex-col gap-3">
          {sides.map((side) => (
            <div
              key={side.label}
              className={`rounded-2xl border p-4 transition ${
                side.score > pointsPerMatch / 2
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-line bg-ink'
              }`}
            >
              <p className="mb-3 text-sm font-medium leading-snug">{side.label}</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setScore1((s) => Math.max(0, Math.min(pointsPerMatch, s - side.delta)))}
                  disabled={side.score <= 0}
                  className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
                  aria-label={`Убавить очки: ${side.label}`}
                >
                  −
                </button>
                <span className="flex-1 text-center text-4xl font-bold tabular-nums">
                  {side.score}
                </span>
                <button
                  type="button"
                  onClick={() => setScore1((s) => Math.max(0, Math.min(pointsPerMatch, s + side.delta)))}
                  disabled={side.score >= pointsPerMatch}
                  className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
                  aria-label={`Прибавить очки: ${side.label}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">
            Быстрый выбор — очки первой пары
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: pointsPerMatch + 1 }, (_, i) => i).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setScore1(value)}
                className={`rounded-lg py-2 text-sm font-semibold tabular-nums transition ${
                  value === score1 ? 'bg-accent text-accent-ink' : 'bg-ink text-muted'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSave(score1, score2)}
            className="tap rounded-xl bg-accent px-4 font-bold text-accent-ink"
          >
            Сохранить счёт
          </button>
          {match.score1 !== null && (
            <button
              type="button"
              onClick={onClear}
              className="tap rounded-xl border border-line px-4 font-medium text-muted"
            >
              Сбросить результат
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
