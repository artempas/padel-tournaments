'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import { MAX_COURTS, MAX_PLAYERS, MIN_PLAYERS } from '@/lib/americano';
import { FORMAT_OPTIONS, tournamentSize } from '@/lib/formats';
import { DEFAULT_ROUNDS, MAX_ROUNDS, MIN_ROUNDS } from '@/lib/mexicano';
import { plural } from '@/lib/plural';
import { randomTournamentName } from '@/lib/tournament-names';
import type { RosterPlayer } from '@/lib/roster';
import type { PlayableFormat } from '@/lib/types';

export interface NewTournamentFormProps {
  /** Generated on the server so the first render matches the client. */
  initialName: string;
  initialPlayers?: string[];
  initialCourts?: number;
  initialPointsPerMatch?: number;
  initialFormat?: PlayableFormat;
  initialRounds?: number;
  /** Everyone the organiser has entered before, for one-tap adding. */
  roster?: RosterPlayer[];
  /** Name of the tournament these players were copied from, if any. */
  repeatedFrom?: string | null;
}

export default function NewTournamentForm({
  initialName,
  initialPlayers = [],
  initialCourts = 1,
  initialPointsPerMatch = 16,
  initialFormat = 'americano',
  initialRounds = DEFAULT_ROUNDS,
  roster = [],
  repeatedFrom = null,
}: NewTournamentFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [players, setPlayers] = useState<string[]>(initialPlayers);
  const [draft, setDraft] = useState('');
  const [courts, setCourts] = useState(initialCourts);
  const [pointsPerMatch, setPointsPerMatch] = useState(initialPointsPerMatch);
  const [format, setFormat] = useState<PlayableFormat>(initialFormat);
  const [rounds, setRounds] = useState(initialRounds);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usefulCourts = Math.max(1, Math.floor(players.length / 4));
  const effectiveCourts = Math.min(courts, usefulCourts);

  const preview = useMemo(() => {
    if (players.length < MIN_PLAYERS) return null;
    return tournamentSize(format, players.length, effectiveCourts, rounds);
  }, [format, players.length, effectiveCourts, rounds]);

  const chosen = useMemo(
    () => new Set(players.map((p) => p.toLocaleLowerCase('ru'))),
    [players],
  );
  const available = useMemo(
    () => roster.filter((p) => !chosen.has(p.name.toLocaleLowerCase('ru'))),
    [roster, chosen],
  );

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
          format,
          // У американо длину задаёт состав — сервер такое поле проигнорирует.
          ...(format === 'mexicano' ? { rounds } : {}),
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

      {repeatedFrom && (
        <p className="mb-5 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          Состав скопирован из турнира «{repeatedFrom}». Можно поправить перед стартом.
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-5">
        <section className="card p-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Название</span>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Пятничный американо"
                maxLength={80}
                className="tap min-w-0 flex-1 rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setName(randomTournamentName())}
                className="tap w-14 shrink-0 rounded-xl border border-line text-lg"
                aria-label="Придумать другое название"
                title="Придумать другое название"
              >
                🎲
              </button>
            </div>
          </label>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Формат</h2>

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFormat(option.value)}
                aria-pressed={format === option.value}
                className={`tap rounded-lg px-3 text-sm font-semibold transition ${
                  format === option.value ? 'bg-surface-2 text-text' : 'text-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            {FORMAT_OPTIONS.find((o) => o.value === format)?.hint}
          </p>

          {format === 'mexicano' && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-3 text-sm font-medium text-muted">Раундов</h3>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setRounds((r) => Math.max(MIN_ROUNDS, r - 1))}
                  disabled={rounds <= MIN_ROUNDS}
                  className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
                >
                  −
                </button>
                <span className="flex-1 text-center text-3xl font-bold tabular-nums">{rounds}</span>
                <button
                  type="button"
                  onClick={() => setRounds((r) => Math.min(MAX_ROUNDS, r + 1))}
                  disabled={rounds >= MAX_ROUNDS}
                  className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          )}
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

          {available.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-muted">Сохранённые игроки</p>
                <button
                  type="button"
                  onClick={() => addPlayers(available.map((p) => p.name).join('\n'))}
                  className="text-xs font-semibold text-accent"
                >
                  Добавить всех
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {available.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => addPlayers(person.name)}
                    disabled={players.length >= MAX_PLAYERS}
                    className="rounded-full border border-line bg-ink px-3 py-2 text-sm disabled:opacity-40"
                  >
                    + {person.name}
                  </button>
                ))}
              </div>
            </div>
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
