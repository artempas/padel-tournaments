'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ScoreSheet from './ScoreSheet';
import ThemeToggle from './ThemeToggle';
import { flushQueue, queueScore, readQueue } from '@/lib/offline';
import { applyPendingScores, type PendingScore } from '@/lib/pending-scores';
import { plural } from '@/lib/plural';
import { computeStandings, restingInRound } from '@/lib/standings';
import type { Match, Player, TournamentDetail } from '@/lib/types';

type Tab = 'matches' | 'table';

function teamName(ids: [string, string], playersById: Map<string, Player>): string {
  return ids.map((id) => playersById.get(id)?.name ?? '—').join(' / ');
}

export default function TournamentView({ initial }: { initial: TournamentDetail }) {
  const router = useRouter();
  // `server` is the last state the server confirmed; `tournament` is that with
  // the offline queue laid on top — which is what the organiser actually sees.
  const [server, setServer] = useState(initial);
  const [pending, setPending] = useState<PendingScore[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>(initial.status === 'finished' ? 'table' : 'matches');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);

  const tournament = useMemo(() => applyPendingScores(server, pending), [server, pending]);
  const pendingIds = useMemo(() => new Set(pending.map((p) => p.matchId)), [pending]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flushQueue(initial.id);
      setPending(result.pending);
      if (result.tournament) {
        setServer(result.tournament);
        router.refresh();
      }
      if (result.offline) setOnline(false);
      if (result.errors.length > 0) setError(result.errors[0]);
    } finally {
      setSyncing(false);
    }
  }, [initial.id, router]);

  // Scores left over from a previous visit — the tab may have been closed with
  // no connection — are shown at once and sent as soon as there is one.
  useEffect(() => {
    readQueue(initial.id)
      .then(setPending)
      .catch(() => {});
    setOnline(navigator.onLine);
    if (navigator.onLine) void sync();
  }, [initial.id, sync]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [sync]);

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
  const remaining = total - playedCount;
  const isFinished = tournament.status === 'finished';
  // "Early" only while something is genuinely left unplayed — an organiser who
  // closes early and then plays the rest ends up with an ordinary finish.
  const finishedEarly = isFinished && remaining > 0;
  const currentRound =
    rounds.find(([, matches]) => matches.some((m) => m.score1 === null))?.[0] ?? null;

  const editing = editingId ? (tournament.matches.find((m) => m.id === editingId) ?? null) : null;

  /**
   * The score is written to the local queue first and sent second, so the sheet
   * closes immediately and nothing depends on there being a connection. The
   * queue is also what the screen renders from until the server confirms.
   */
  async function saveScore(matchId: string, score1: number | null, score2: number | null) {
    const entry: PendingScore = {
      tournamentId: server.id,
      matchId,
      score1,
      score2,
      queuedAt: Date.now(),
    };
    const next = [...pending.filter((p) => p.matchId !== matchId), entry];

    setError(null);
    setEditingId(null);
    setPending(next);
    // Finishing the last match is the moment the final table matters.
    if (applyPendingScores(server, next).status === 'finished') setTab('table');

    await queueScore(entry);
    await sync();
  }

  async function setClosed(closedEarly: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ closedEarly }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Не удалось изменить статус турнира');

      const updated = data.tournament as TournamentDetail;
      setServer(updated);
      setConfirmFinish(false);
      setTab(updated.status === 'finished' ? 'table' : 'matches');
      router.refresh();
    } catch (err) {
      // Unlike a score, this one is not queued: closing a tournament is rare
      // and can wait for a connection.
      if (err instanceof TypeError) {
        setError('Нет сети — статус турнира можно изменить только со связью');
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось изменить статус турнира');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      router.replace('/tournaments');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Нет сети — турнир можно удалить только со связью'
          : 'Не удалось удалить турнир',
      );
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

      {isFinished && (
        <div className="mb-5 rounded-2xl border border-accent/50 bg-accent/10 px-4 py-3">
          <p className="font-semibold text-accent">
            {finishedEarly ? 'Турнир завершён досрочно 🏁' : 'Турнир завершён 🏆'}
          </p>
          {playedCount > 0 ? (
            <p className="mt-0.5 text-sm text-muted">
              Победитель — {standings[0]?.name} ({standings[0]?.pointsFor} очков).
              {remaining > 0 && ` Не сыграно ${remaining} ${plural(remaining, 'матч', 'матча', 'матчей')}.`}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-muted">Ни одного матча не сыграно.</p>
          )}
          {tournament.closedEarly && remaining > 0 && (
            <button
              type="button"
              onClick={() => setClosed(false)}
              disabled={busy}
              className="tap mt-3 w-full rounded-xl border border-accent/50 px-4 text-sm font-semibold text-accent disabled:opacity-40"
            >
              Продолжить турнир
            </button>
          )}
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

      {(!online || pending.length > 0) && (
        <div className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3">
          <p className="text-sm font-semibold text-warn">
            {online ? 'Счёт ещё не отправлен' : 'Нет сети'}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {pending.length > 0
              ? `${pending.length} ${plural(pending.length, 'результат', 'результата', 'результатов')} ` +
                `${plural(pending.length, 'сохранён', 'сохранены', 'сохранены')} на этом устройстве ` +
                'и уйдут на сервер сами, как только появится связь.'
              : 'Счёт можно вносить дальше — он сохранится на устройстве и отправится сам.'}
          </p>
          {pending.length > 0 && online && (
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              className="tap mt-3 w-full rounded-xl border border-warn/50 px-4 text-sm font-semibold text-warn disabled:opacity-40"
            >
              {syncing ? 'Отправляем…' : 'Отправить сейчас'}
            </button>
          )}
        </div>
      )}

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
                    const unsent = pendingIds.has(match.id);

                    const summary =
                      (played ? `счёт ${match.score1}:${match.score2}` : 'счёт не внесён') +
                      (unsent ? ', ещё не отправлен' : '');

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
                            {unsent ? (
                              <span className="text-xs font-medium text-warn">не отправлено</span>
                            ) : (
                              !played && (
                                <span className="text-xs font-medium text-accent">Внести счёт</span>
                              )
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

          {!isFinished && remaining > 0 && (
            <div className="pt-1">
              {confirmFinish ? (
                <div className="card p-4">
                  <p className="mb-1 text-sm font-semibold">Завершить турнир досрочно?</p>
                  <p className="mb-3 text-sm text-muted">
                    {remaining} {plural(remaining, 'матч', 'матча', 'матчей')} останется без
                    счёта — они не попадут в таблицу. Турнир можно будет продолжить.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setClosed(true)}
                      disabled={busy}
                      className="tap flex-1 rounded-xl bg-accent px-4 font-bold text-accent-ink disabled:opacity-40"
                    >
                      Завершить
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmFinish(false)}
                      className="tap flex-1 rounded-xl border border-line px-4 font-medium text-muted"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmFinish(true)}
                  className="tap w-full rounded-xl border border-line px-4 text-sm font-medium text-muted"
                >
                  Завершить турнир досрочно
                </button>
              )}
            </div>
          )}
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
                    isFinished && playedCount > 0 && index === 0 ? 'bg-accent/10' : ''
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

          <Link
            href={`/tournaments/new?from=${tournament.id}`}
            className="tap flex items-center justify-center rounded-xl bg-accent px-4 font-bold text-accent-ink"
          >
            Новый турнир с этим составом
          </Link>

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
