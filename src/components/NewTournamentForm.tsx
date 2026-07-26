'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import { MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS, totalMatchesFor } from '@/lib/americano';

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export default function NewTournamentForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [players, setPlayers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [courts, setCourts] = useState(1);
  const [pointsPerMatch, setPointsPerMatch] = useState(16);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usefulCourts = Math.max(1, Math.floor(players.length / 4));
  const effectiveCourts = Math.min(courts, usefulCourts);

  const preview = useMemo(() => {
    if (players.length < MIN_PLAYERS) return null;
    const matches = totalMatchesFor(players.length);
    return { matches, rounds: Math.ceil(matches / effectiveCourts) };
  }, [players.length, effectiveCourts]);

  function addPlayers(raw: string) {
    // One paste can carry a whole roster — split on commas and newlines.
    const incoming = raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (incoming.length === 0) return;

    setPlayers((current) => {
      const taken = new Set(current.map((p) => p.toLocaleLowerCase('ru')));
      const next = [...current];
      for (const candidate of incoming) {
        const key = candidate.toLocaleLowerCase('ru');
        if (taken.has(key) || next.length >= MAX_PLAYERS) continue;
        taken.add(key);
        next.push(candidate.slice(0, 40));
      }
      return next;
    });
    setDraft('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (players.length < MIN_PLAYERS) {
      setError(`Нужно минимум ${MIN_PLAYERS} игрока`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Турнир',
          players,
          courts: effectiveCourts,
          pointsPerMatch,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Не удалось создать турнир');
      router.replace(`/tournaments/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать турнир');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/tournaments"
          className="tap flex w-11 items-center justify-center rounded-xl border border-line text-muted"
          aria-label="Назад"
        >
          ←
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Новый турнир</h1>
        <ThemeToggle />
      </header>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <section className="card p-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Название</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Пятничный американо"
              maxLength={80}
              className="tap rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
          </label>
        </section>

        <section className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Игроки</h2>
            <span className="text-sm tabular-nums text-muted">
              {players.length} / {MAX_PLAYERS}
            </span>
          </div>

          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPlayers(draft);
                }
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (/[\n,;]/.test(text)) {
                  e.preventDefault();
                  addPlayers(text);
                }
              }}
              placeholder="Имя игрока"
              maxLength={40}
              enterKeyHint="done"
              className="tap min-w-0 flex-1 rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => addPlayers(draft)}
              disabled={!draft.trim() || players.length >= MAX_PLAYERS}
              className="tap shrink-0 rounded-xl bg-surface-2 px-4 font-semibold text-text disabled:opacity-40"
            >
              Добавить
            </button>
          </div>

          {players.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
              {players.map((player, index) => (
                <li key={player} className="flex items-center gap-3 bg-ink px-3 py-2.5">
                  <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{player}</span>
                  <button
                    type="button"
                    onClick={() => setPlayers((c) => c.filter((p) => p !== player))}
                    className="shrink-0 rounded-lg px-2 py-1 text-muted"
                    aria-label={`Удалить ${player}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs leading-relaxed text-muted">
            От {MIN_PLAYERS} до {MAX_PLAYERS} игроков. Список можно вставить целиком — через
            запятую или с новой строки.
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Корты</h2>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setCourts((c) => Math.max(1, c - 1))}
              disabled={courts <= 1}
              className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
            >
              −
            </button>
            <span className="flex-1 text-center text-3xl font-bold tabular-nums">{courts}</span>
            <button
              type="button"
              onClick={() => setCourts((c) => Math.min(MAX_COURTS, c + 1))}
              disabled={courts >= MAX_COURTS}
              className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>

          {players.length >= MIN_PLAYERS && courts > usefulCourts && (
            <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              На {players.length} игроков одновременно занять получится только{' '}
              {usefulCourts} {plural(usefulCourts, 'корт', 'корта', 'кортов')} — остальные
              простаивают.
            </p>
          )}
        </section>

        <section className="card p-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="font-semibold">Очков в матче</span>
            <span className="text-sm text-muted">{pointsPerMatch} {showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setPointsPerMatch((p) => Math.max(1, p - 1))}
                className="tap w-14 rounded-xl border border-line text-xl font-bold"
              >
                −
              </button>
              <span className="flex-1 text-center text-3xl font-bold tabular-nums">
                {pointsPerMatch}
              </span>
              <button
                type="button"
                onClick={() => setPointsPerMatch((p) => Math.min(200, p + 1))}
                className="tap w-14 rounded-xl border border-line text-xl font-bold"
              >
                +
              </button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Матч играется до фиксированной суммы очков на двоих — по умолчанию 16.
          </p>
        </section>

        {preview && (
          <p className="text-center text-sm text-muted">
            {preview.matches} {plural(preview.matches, 'матч', 'матча', 'матчей')} ·{' '}
            {preview.rounds} {plural(preview.rounds, 'раунд', 'раунда', 'раундов')} ·{' '}
            {effectiveCourts} {plural(effectiveCourts, 'корт', 'корта', 'кортов')}
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
            {error}
          </p>
        )}

        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-ink/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-2xl">
            <button
              type="submit"
              disabled={busy || players.length < MIN_PLAYERS}
              className="tap w-full rounded-xl bg-accent px-4 font-bold text-accent-ink disabled:opacity-40"
            >
              {busy ? 'Составляем расписание…' : 'Создать турнир'}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
