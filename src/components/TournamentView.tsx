'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ScoreSheet from './ScoreSheet';
import ThemeToggle from './ThemeToggle';
import { computeStandings, restingInRound } from '@/lib/standings';
import type { Match, Player, TournamentDetail } from '@/lib/types';

type Tab = 'matches' | 'table';

function teamName(ids: [string, string], playersById: Map<string, Player>): string {
  return ids.map((id) => playersById.get(id)?.name ?? '—').join(' / ');
}

export default function TournamentView({ initial }: { initial: TournamentDetail }) {
  const router = useRouter();
  const [tournament, setTournament] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.status === 'finished' ? 'table' : 'matches');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const playersById = useMemo(
    () => new Map(tournament.players.map((p) => [p.id, p])),
    [tournament.players],
  );

  const rounds = useMemo(() => {
    const grouped = new Map<number, Match[]>();
    for (const m of tournament.matches) {
      if (!grouped.has(m.round)) grouped.set(m.round, []);
      grouped.get(m.round)!.push(m);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  }, [tournament.matches]);

  const standings = useMemo(
    () => computeStandings(tournament.players, tournament.matches),
    [tournament.players, tournament.matches],
  );

  const playedCount = tournament.matches.filter((m) => m.score1 !== null).length;
  const total = tournament.matches.length;
  const allPlayed = playedCount === total && total > 0;
  const currentRound =
    rounds.find(([, matches]) => matches.some((m) => m.score1 === null))?.[0] ?? null;

  const editing = editingId ? (tournament.matches.find((m) => m.id === editingId) ?? null) : null;

  async function saveScore(matchId: string, score1: number | null, score2: number | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score1, score2 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Не удалось сохранить счёт');

      const updated = data.tournament as TournamentDetail;
      setTournament(updated);
      setEditingId(null);
      // Finishing the last match is the moment the final table matters.
      if (updated.status === 'finished') setTab('table');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить счёт');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/tournaments/${tournament.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.replace('/tournaments');
      router.refresh();
    } else {
      setError('Не удалось удалить турнир');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-5">
        <div className="mb-3 flex items-center gap-3">
          <Link
            href="/tournaments"
            className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted"
            aria-label="К списку турниров"
          >
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{tournament.name}</h1>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${total ? (playedCount / total) * 100 : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {playedCount}/{total}
          </span>
        </div>
      </header>

      {allPlayed && (
        <div className="mb-5 rounded-2xl border border-accent/50 bg-accent/10 px-4 py-3">
          <p className="font-semibold text-accent">Турнир завершён 🏆</p>
          <p className="mt-0.5 text-sm text-muted">
            Победитель — {standings[0]?.name} ({standings[0]?.pointsFor} очков).
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
        {(
          [
            ['matches', 'Матчи'],
            ['table', 'Таблица'],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`tap rounded-lg px-3 text-sm font-semibold transition ${
              tab === value ? 'bg-surface-2 text-text' : 'text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {tab === 'matches' ? (
        <div className="flex flex-col gap-6">
          {rounds.map(([round, matches]) => {
            const resting = restingInRound(tournament.players, tournament.matches, round);
            const isCurrent = round === currentRound;

            return (
              <section key={round}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
                    Раунд {round}
                  </h2>
                  {isCurrent && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
                      сейчас
                    </span>
                  )}
                </div>

                <ul className="flex flex-col gap-2">
                  {matches.map((match) => {
                    const played = match.score1 !== null && match.score2 !== null;
                    const team1Won = played && match.score1! > match.score2!;
                    const team2Won = played && match.score2! > match.score1!;

                    const summary = played
                      ? `счёт ${match.score1}:${match.score2}`
                      : 'счёт не внесён';

                    return (
                      <li key={match.id}>
                        <button
                          type="button"
                          onClick={() => setEditingId(match.id)}
                          aria-label={
                            `Раунд ${match.round}, корт ${match.court}: ` +
                            `${teamName(match.team1, playersById)} против ` +
                            `${teamName(match.team2, playersById)}, ${summary}`
                          }
                          className={`card w-full p-3 text-left transition active:scale-[0.99] ${
                            isCurrent && !played ? 'border-accent/50' : ''
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="rounded-md bg-court/20 px-2 py-0.5 text-[11px] font-semibold text-court">
                              Корт {match.court}
                            </span>
                            {!played && (
                              <span className="text-xs font-medium text-accent">Внести счёт</span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`min-w-0 flex-1 text-sm leading-snug ${
                                team1Won ? 'font-bold text-accent' : ''
                              }`}
                            >
                              {teamName(match.team1, playersById)}
                            </span>
                            <span className="shrink-0 text-center text-base font-bold tabular-nums">
                              {played ? `${match.score1} : ${match.score2}` : '–  :  –'}
                            </span>
                            <span
                              className={`min-w-0 flex-1 text-right text-sm leading-snug ${
                                team2Won ? 'font-bold text-accent' : ''
                              }`}
                            >
                              {teamName(match.team2, playersById)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {resting.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    Отдыхают: {resting.map((p) => p.name).join(', ')}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[2rem_1fr_3rem_2.5rem_3rem] items-center gap-2 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Игрок</span>
              <span className="text-right">Очки</span>
              <span className="text-right">Игр</span>
              <span className="text-right">Разн.</span>
            </div>
            <ul className="divide-y divide-line/70">
              {standings.map((row, index) => (
                <li
                  key={row.playerId}
                  className={`grid grid-cols-[2rem_1fr_3rem_2.5rem_3rem] items-center gap-2 px-3 py-3 ${
                    allPlayed && index === 0 ? 'bg-accent/10' : ''
                  }`}
                >
                  <span className="text-sm font-bold tabular-nums text-muted">{index + 1}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
                  <span className="text-right text-base font-bold tabular-nums">
                    {row.pointsFor}
                  </span>
                  <span className="text-right text-sm tabular-nums text-muted">{row.played}</span>
                  <span className="text-right text-sm tabular-nums text-muted">
                    {row.diff > 0 ? `+${row.diff}` : row.diff}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Очки — сумма всех очков, набранных игроком во всех его матчах. При равенстве выше тот,
            у кого лучше разница очков, затем — больше побед.
          </p>

          <div className="pt-2">
            {confirmDelete ? (
              <div className="card p-4">
                <p className="mb-3 text-sm">Удалить турнир вместе со всеми результатами?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="tap flex-1 rounded-xl bg-warn px-4 font-bold text-ink disabled:opacity-40"
                  >
                    Удалить
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="tap flex-1 rounded-xl border border-line px-4 font-medium text-muted"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="tap w-full rounded-xl border border-line px-4 text-sm font-medium text-muted"
              >
                Удалить турнир
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <ScoreSheet
          match={editing}
          playersById={playersById}
          pointsPerMatch={tournament.pointsPerMatch}
          busy={busy}
          onSave={(s1, s2) => saveScore(editing.id, s1, s2)}
          onClear={() => saveScore(editing.id, null, null)}
          onClose={() => setEditingId(null)}
        />
      )}
    </main>
  );
}
