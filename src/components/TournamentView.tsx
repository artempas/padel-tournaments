'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DynamicsChart from './DynamicsChart';
import InsightCards from './InsightCards';
import ScoreSheet from './ScoreSheet';
import ShareResultsSheet from './ShareResultsSheet';
import ThemeToggle from './ThemeToggle';
import { formatLabel, tournamentSize, upcomingRounds } from '@/lib/formats';
import {
  balanceContext,
  balanceSummary,
  dynamicsInsights,
  matchBalance,
  roundHistory,
  tournamentInsights,
  type MatchBalance,
} from '@/lib/insights';
import { MAX_ROUNDS, MIN_ROUNDS } from '@/lib/mexicano';
import { can, canScore, type ClubRole } from '@/lib/permissions';
import { flushQueue, queueScore, readQueue } from '@/lib/offline';
import { useOptimisticState } from '@/lib/optimistic';
import { applyPendingScores, isComplete, type PendingScore } from '@/lib/pending-scores';
import { plural } from '@/lib/plural';
import { failureMessage, request } from '@/lib/request';
import type { ResultsCardData } from '@/lib/results-card';
import {
  computeRatings,
  matchRatings,
  type MatchRating,
  type RatedMatch,
  type TeamRating,
} from '@/lib/rating';
import { computeStandings, restingInRound } from '@/lib/standings';
import type { Match, Player, TournamentDetail } from '@/lib/types';

type Tab = 'matches' | 'table' | 'dynamics';

/**
 * Удаление уводит с экрана раньше ответа сервера, поэтому об отказе некому
 * рассказать: компонента уже нет. Модуль живёт дольше — он и передаёт ошибку
 * турниру, на который пользователя вернули.
 */
let failedDelete: { tournamentId: string; message: string } | null = null;

function teamName(ids: [string, string], playersById: Map<string, Player>): string {
  return ids.map((id) => playersById.get(id)?.name ?? '—').join(' / ');
}

/**
 * Цвет чипа по силе перекоса: зелёный — команды равны, жёлтый — перекос
 * заметен, красный — матч был неравным. Индекс — это `MatchBalance.level`.
 */
const BALANCE_TONE = [
  'bg-accent/10 text-accent',
  'bg-warn/15 text-warn',
  'bg-danger/15 text-danger',
  'bg-danger/15 text-danger',
];

/** Знак всегда на месте: рядом с рейтингом «3» и «+3» — разные утверждения. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Прибавка выделяется цветом, потеря остаётся приглушённой — как в таблице. */
function Delta({ value }: { value: number }) {
  return (
    <span className={`tabular-nums ${value > 0 ? 'font-semibold text-accent' : ''}`}>
      {signed(value)}
    </span>
  );
}

/**
 * Рейтинг одной пары в сыгранном матче: сначала среднее по двоим — та самая
 * сила пары, по которой считается ожидание, — потом каждый по отдельности, в
 * том же порядке, в каком имена стоят в строке над этим.
 */
function TeamRatingBlock({
  team,
  playersById,
  align,
}: {
  team: TeamRating;
  playersById: Map<string, Player>;
  align: 'left' | 'right';
}) {
  return (
    <div className={`min-w-0 flex-1 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="font-semibold text-text">
        ⌀ {team.rating} <Delta value={team.delta} />
      </p>
      {team.players.map((player) => (
        <p key={player.id} className="truncate">
          {playersById.get(player.id)?.name ?? '—'} {player.rating}{' '}
          <Delta value={player.delta} />
        </p>
      ))}
    </div>
  );
}

/** То же самое словами — карточка целиком читается одной строкой aria-label. */
function ratingSummary(rating: MatchRating, playersById: Map<string, Player>): string {
  const side = (team: TeamRating): string =>
    team.players
      .map((p) => `${playersById.get(p.id)?.name ?? '—'} ${p.rating} (${signed(p.delta)})`)
      .join(', ') + `, в среднем ${team.rating} (${signed(team.delta)})`;

  return `Рейтинг на конец матча: ${side(rating.teamA)}; ${side(rating.teamB)}`;
}

export default function TournamentView({
  initial,
  role,
  myPlayerId,
}: {
  initial: TournamentDetail;
  /** Роль в клубе, которому принадлежит турнир. */
  role: ClubRole;
  /** Место смотрящего в этом турнире, если он в нём играет. */
  myPlayerId: string | null;
}) {
  const router = useRouter();
  // `server` is the tournament as far as the organiser is concerned — server
  // state plus changes that are on the screen but not yet confirmed;
  // `tournament` is that with the offline score queue laid on top.
  const {
    value: server,
    error,
    mutate,
    set: setServer,
    setError,
  } = useOptimisticState(initial);
  const [pending, setPending] = useState<PendingScore[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>(initial.status === 'finished' ? 'table' : 'matches');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extraRounds, setExtraRounds] = useState(2);

  const tournament = useMemo(() => applyPendingScores(server, pending), [server, pending]);
  const pendingIds = useMemo(() => new Set(pending.map((p) => p.matchId)), [pending]);

  // Права. Скрытая кнопка — вежливость, а не защита: те же правила проверяет
  // сервер, и `can` здесь тот же самый, что там.
  const mayManage = can(role, 'tournament:close');
  const mayDelete = can(role, 'tournament:delete');
  const mayCreate = can(role, 'tournament:create');

  /**
   * Можно ли вносить счёт в конкретный матч. Участнику — только в свой и
   * только пока турнир идёт; администратору — всегда.
   */
  const mayScore = useCallback(
    (match: Match): boolean =>
      canScore(role, {
        playing: myPlayerId !== null && [...match.team1, ...match.team2].includes(myPlayerId),
        running: tournament.status !== 'finished',
      }),
    [role, myPlayerId, tournament.status],
  );

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
  }, [initial.id, router, setServer, setError]);

  // Scores left over from a previous visit — the tab may have been closed with
  // no connection — are shown at once and sent as soon as there is one.
  useEffect(() => {
    readQueue(initial.id)
      .then(setPending)
      .catch(() => {});
    setOnline(navigator.onLine);
    if (navigator.onLine) void sync();
  }, [initial.id, sync]);

  // A deletion the server refused: the organiser is back on the tournament and
  // is owed the reason.
  useEffect(() => {
    if (failedDelete?.tournamentId !== initial.id) return;
    setError(failedDelete.message);
    failedDelete = null;
  }, [initial.id, setError]);

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

  /**
   * Сколько турнир принёс каждому — считается здесь, а не на сервере: матчи
   * приходят в порядке раундов, стартовое состояние сервер уже прислал, и
   * этого достаточно. Зато дельта пересчитывается прямо при вводе счёта, вместе
   * с таблицей, и одинаково работает с очередью неотправленных результатов.
   */
  const ratingDelta = useMemo(() => {
    const played: RatedMatch[] = tournament.matches
      .filter((m) => m.score1 !== null && m.score2 !== null)
      .map((m) => ({ teamA: m.team1, teamB: m.team2, scoreA: m.score1!, scoreB: m.score2! }));

    const after = computeRatings(played, Object.entries(tournament.ratingBefore));

    return new Map(
      [...after].map(([id, r]) => [
        id,
        Math.round(r.rating) - Math.round(tournament.ratingBefore[id]?.rating ?? r.rating),
      ]),
    );
  }, [tournament.matches, tournament.ratingBefore]);

  /**
   * Рейтинг четвёрки в каждом сыгранном матче — на тот момент, когда его
   * доиграли. Прогон тот же, что у дельты за турнир, и от того же состояния:
   * снимок матча — это просто место в этом прогоне.
   *
   * Отсюда и «сохраняется на момент завершения»: сыгранные позже матчи чисел в
   * карточке не трогают, а поправленный счёт пересчитывает их вместе со всем
   * остальным — расходиться с историей тут нечему.
   */
  const ratingByMatch = useMemo(() => {
    const played = tournament.matches.filter(
      (m): m is Match & { score1: number; score2: number } =>
        m.score1 !== null && m.score2 !== null,
    );

    const rated = matchRatings(
      played.map((m) => ({ teamA: m.team1, teamB: m.team2, scoreA: m.score1, scoreB: m.score2 })),
      Object.entries(tournament.ratingBefore),
    );

    const byMatch = new Map<string, MatchRating>();
    played.forEach((m, index) => {
      const rating = rated[index];
      if (rating) byMatch.set(m.id, rating);
    });
    return byMatch;
  }, [tournament.matches, tournament.ratingBefore]);

  // Насколько равны были команды в каждом сыгранном матче. Считается разом на
  // весь турнир: сила игрока — это все его остальные матчи, и меняется она с
  // каждым внесённым счётом.
  const balances = useMemo(() => {
    const context = balanceContext(tournament.matches);
    const map = new Map<string, MatchBalance>();
    for (const match of tournament.matches) {
      const balance = matchBalance(context, match);
      if (balance) map.set(match.id, balance);
    }
    return map;
  }, [tournament.matches]);

  const playedCount = tournament.matches.filter((m) => m.score1 !== null).length;
  // У мексикано матчи создаются раунд за раундом, поэтому длину турнира
  // приходится считать, а не брать из уже созданного — но и не меньше него:
  // продлённое американо длиннее, чем «каждый с каждым».
  const total = tournamentSize(
    tournament.format,
    tournament.players.length,
    tournament.courts,
    tournament.roundsPlanned,
    tournament.matches.length,
  ).matches;
  const remaining = total - playedCount;
  const isFinished = tournament.status === 'finished';
  // "Early" only while something is genuinely left unplayed — an organiser who
  // closes early and then plays the rest ends up with an ordinary finish.
  const finishedEarly = isFinished && remaining > 0;
  const currentRound =
    rounds.find(([, matches]) => matches.some((m) => m.score1 === null))?.[0] ?? null;

  // Итоги подводятся у завершённого турнира: на середине факты меняются каждый
  // раунд, а «камбэк» и «лидер до конца» ещё ничего не значат.
  const insights = useMemo(
    () => (isFinished ? tournamentInsights(tournament.players, tournament.matches) : []),
    [isFinished, tournament.players, tournament.matches],
  );
  const history = useMemo(
    () => (isFinished ? roundHistory(tournament.players, tournament.matches) : []),
    [isFinished, tournament.players, tournament.matches],
  );
  const dynamics = useMemo(
    () => (isFinished ? dynamicsInsights(tournament.players, tournament.matches) : []),
    [isFinished, tournament.players, tournament.matches],
  );

  // Один срез — это не динамика, а та же итоговая таблица сбоку.
  const hasDynamics = history.length >= 2;
  // Вкладка может исчезнуть под ногами: турнир вернули в игру кнопкой
  // «Продолжить». Тогда показываем таблицу, не дожидаясь клика.
  const activeTab: Tab = tab === 'dynamics' && !hasDynamics ? 'table' : tab;

  // Раунды, которые уже стоят в расписании, но составов у них ещё нет.
  // Завершённому турниру их показывать не за чем — играть больше нечего.
  const upcoming = useMemo(
    () =>
      isFinished
        ? []
        : upcomingRounds(
            tournament.format,
            tournament.players.length,
            tournament.courts,
            tournament.roundsPlanned,
            rounds.length > 0 ? rounds[rounds.length - 1][0] : 0,
          ),
    [
      isFinished,
      tournament.format,
      tournament.players.length,
      tournament.courts,
      tournament.roundsPlanned,
      rounds,
    ],
  );

  // Сколько раундов ещё можно добавить. У мексикано длина турнира записана
  // числом и упирается в общий потолок; у американо её задаёт состав, и
  // ограничен только размер одной добавки.
  const maxExtra =
    tournament.roundsPlanned === null ? MAX_ROUNDS : MAX_ROUNDS - tournament.roundsPlanned;
  const extra = Math.min(extraRounds, maxExtra);

  const editing = editingId ? (tournament.matches.find((m) => m.id === editingId) ?? null) : null;

  // Картинку пересобирать на каждый рендер незачем — шторка рисует её по этому
  // объекту, поэтому он должен меняться только вместе с результатами.
  const shareData = useMemo<ResultsCardData>(
    () => ({
      name: tournament.name,
      format: formatLabel(tournament.format),
      date: tournament.finishedAt ?? tournament.createdAt,
      finished: isFinished,
      playedCount,
      totalMatches: total,
      standings,
    }),
    [
      tournament.name,
      tournament.format,
      tournament.finishedAt,
      tournament.createdAt,
      isFinished,
      playedCount,
      total,
      standings,
    ],
  );

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

  /**
   * Завершение и возврат в игру переключают экран сразу: ждать ответа, чтобы
   * увидеть итоговую таблицу, незачем. В очередь, в отличие от счёта, это не
   * попадает — действие редкое, и при отказе всё вернётся как было.
   */
  function setClosed(closedEarly: boolean) {
    const before = server;

    setConfirmFinish(false);
    setTab(closedEarly || isComplete(tournament, tournament.matches) ? 'table' : 'matches');

    mutate({
      next: (t) => {
        const finished = closedEarly || isComplete(t, t.matches);
        return {
          ...t,
          closedEarly,
          // Статус выводится так же, как на сервере — во вью tournament_overview.
          status: finished ? 'finished' : 'running',
          // Точную метку поставит сервер, здесь она лишь чтобы состояние не
          // противоречило само себе.
          finishedAt: finished ? (t.finishedAt ?? new Date().toISOString()) : null,
        };
      },
      undo: (t) => ({
        ...t,
        closedEarly: before.closedEarly,
        status: before.status,
        finishedAt: before.finishedAt,
      }),
      send: async () => {
        const data = await request<{ tournament: TournamentDetail }>(
          `/api/tournaments/${before.id}`,
          { method: 'PATCH', body: JSON.stringify({ closedEarly }) },
        );
        router.refresh();
        return data.tournament;
      },
      message: 'Не удалось изменить статус турнира',
      offline: 'Нет сети — статус турнира можно изменить только со связью',
    });
  }

  /**
   * Продлить турнир. Матчи добавочных раундов рождаются на сервере — у
   * мексикано их вообще не из чего собрать заранее, — поэтому сразу видно
   * только то, что турнир снова идёт. У мексикано к этому добавляется новая
   * длина, и пустые карточки будущих раундов появляются, не дожидаясь ответа.
   *
   * Досрочно завершённый турнир от добавленных раундов сам собой не
   * возобновляется: вернуть его в игру — отдельное решение организатора,
   * кнопка «Продолжить турнир» никуда не делась.
   */
  function addRounds(count: number) {
    const before = server;

    setExtending(false);
    setTab('matches');

    mutate({
      next: (t) => ({
        ...t,
        roundsPlanned: t.roundsPlanned === null ? null : t.roundsPlanned + count,
        // Доигранным турнир быть перестал — матчей стало больше, чем сыграно.
        status: t.closedEarly ? 'finished' : 'running',
        finishedAt: t.closedEarly ? t.finishedAt : null,
      }),
      undo: (t) => ({
        ...t,
        roundsPlanned: before.roundsPlanned,
        status: before.status,
        finishedAt: before.finishedAt,
      }),
      send: async () => {
        const data = await request<{ tournament: TournamentDetail }>(
          `/api/tournaments/${before.id}/rounds`,
          { method: 'POST', body: JSON.stringify({ rounds: count }) },
        );
        router.refresh();
        return data.tournament;
      },
      message: 'Не удалось продлить турнир',
      offline: 'Нет сети — раунды добавляются на сервере, нужна связь',
    });
  }

  /**
   * Экран удалённого турнира не нужен, поэтому «сразу» здесь — это уйти в
   * список, не дожидаясь ответа. Откатывать нечего: если сервер откажет,
   * пользователя вернут на турнир вместе с объяснением.
   */
  function remove() {
    const id = server.id;
    router.replace('/tournaments');

    request(`/api/tournaments/${id}`, { method: 'DELETE' }).then(
      // Список приходит с сервера — его надо перечитать уже без турнира.
      () => router.refresh(),
      (err: unknown) => {
        failedDelete = {
          tournamentId: id,
          message: failureMessage(
            err,
            'Не удалось удалить турнир',
            'Нет сети — турнир можно удалить только со связью',
          ),
        };
        router.replace(`/tournaments/${id}`);
      },
    );
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

        <p className="mb-2 text-xs uppercase tracking-wide text-muted">
          {formatLabel(tournament.format)}
          {tournament.roundsPlanned !== null &&
            ` · ${tournament.roundsPlanned} ${plural(tournament.roundsPlanned, 'раунд', 'раунда', 'раундов')}`}
        </p>

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
          <div className="mt-3 flex flex-col gap-2">
            {mayManage && tournament.closedEarly && remaining > 0 && (
              <button
                type="button"
                onClick={() => setClosed(false)}
                className="tap w-full rounded-xl border border-accent/50 px-4 text-sm font-semibold text-accent"
              >
                Продолжить турнир
              </button>
            )}
            {mayManage && extra >= MIN_ROUNDS && (
              <button
                type="button"
                onClick={() => {
                  setExtending(true);
                  setTab('matches');
                }}
                className="tap w-full rounded-xl border border-accent/50 px-4 text-sm font-semibold text-accent"
              >
                Продлить турнир
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={`mb-5 grid gap-1 rounded-xl bg-surface p-1 ${
          hasDynamics ? 'grid-cols-3' : 'grid-cols-2'
        }`}
      >
        {(
          [
            ['matches', 'Матчи'],
            ['table', 'Таблица'],
            ...(hasDynamics ? [['dynamics', 'Динамика']] : []),
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`tap rounded-lg px-3 text-sm font-semibold transition ${
              activeTab === value ? 'bg-surface-2 text-text' : 'text-muted'
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

      {activeTab === 'matches' ? (
        <div className="flex flex-col gap-6">
          {/* Карточка чужого матча не нажимается, и молчащая кнопка выглядит
              поломкой. Одна строка объясняет её раньше, чем в неё ткнут. */}
          {!mayManage && (
            <p className="rounded-xl border border-line px-4 py-3 text-sm text-muted">
              {tournament.status === 'finished'
                ? 'Турнир завершён — счёт теперь меняют администраторы клуба.'
                : myPlayerId === null
                  ? 'Вы не играете в этом турнире — счёт вносят его участники.'
                  : 'Счёт вносится в матчах, где вы играете. Остальные — только для просмотра.'}
            </p>
          )}

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
                    const balance = balances.get(match.id) ?? null;
                    const rating = ratingByMatch.get(match.id) ?? null;

                    const summary =
                      (played ? `счёт ${match.score1}:${match.score2}` : 'счёт не внесён') +
                      (unsent ? ', ещё не отправлен' : '') +
                      (balance
                        ? `. ${balanceSummary(
                            balance,
                            teamName(match.team1, playersById),
                            teamName(match.team2, playersById),
                          )}`
                        : '') +
                      (rating ? `. ${ratingSummary(rating, playersById)}` : '');

                    return (
                      <li key={match.id}>
                        <button
                          type="button"
                          disabled={!mayScore(match)}
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
                            <span className="flex shrink-0 flex-col items-center gap-0.5">
                              <span className="text-base font-bold tabular-nums">
                                {played ? `${match.score1} : ${match.score2}` : '–  :  –'}
                              </span>
                              {/* Острие смотрит на команду послабее; чем больше
                                  символов, тем крупнее был перекос. */}
                              {balance && (
                                <span
                                  aria-hidden="true"
                                  className={`rounded px-1.5 py-px text-[11px] font-bold leading-4 ${
                                    BALANCE_TONE[balance.level]
                                  }`}
                                >
                                  {balance.symbols}
                                </span>
                              )}
                            </span>
                            <span
                              className={`min-w-0 flex-1 text-right text-sm leading-snug ${
                                team2Won ? 'font-bold text-accent' : ''
                              }`}
                            >
                              {teamName(match.team2, playersById)}
                            </span>
                          </div>

                          {/* Рейтинг появляется вместе со счётом и стоит под
                              составами, столбец в столбец с ними. Словами то
                              же самое уже сказано в aria-label карточки. */}
                          {rating && (
                            <div
                              aria-hidden="true"
                              className="mt-2 flex items-start gap-3 border-t border-line/70 pt-2 text-[11px] leading-4 text-muted"
                            >
                              <TeamRatingBlock
                                team={rating.teamA}
                                playersById={playersById}
                                align="left"
                              />
                              <TeamRatingBlock
                                team={rating.teamB}
                                playersById={playersById}
                                align="right"
                              />
                            </div>
                          )}
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

          {upcoming.map(({ round, matches }, index) => (
            <section key={`upcoming-${round}`}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                Раунд {round}
              </h2>

              <ul className="flex flex-col gap-2">
                {Array.from({ length: matches }, (_, i) => i + 1).map((court) => (
                  <li key={court}>
                    <div className="card p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-md bg-court/20 px-2 py-0.5 text-[11px] font-semibold text-court">
                          Корт {court}
                        </span>
                        <span className="sr-only">составы будут известны позже</span>
                      </div>

                      {/* Пустые места вместо имён: соперники ещё не определены. */}
                      <div className="flex items-center gap-3" aria-hidden="true">
                        <span className="h-3 min-w-0 flex-1 rounded-full border border-dashed border-line" />
                        <span className="shrink-0 text-center text-base font-bold tabular-nums text-muted">
                          –  :  –
                        </span>
                        <span className="h-3 min-w-0 flex-1 rounded-full border border-dashed border-line" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {index === 0 && (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {currentRound !== null
                    ? `Составы соберутся по таблице, когда будут внесены счета всех матчей раунда ${currentRound}` +
                      (pending.length > 0 ? ' и уйдут на сервер.' : '.')
                    : 'Составы соберутся по таблице, когда результаты уйдут на сервер.'}
                </p>
              )}
            </section>
          ))}

          {balances.size > 0 && (
            <p className="text-xs leading-relaxed text-muted">
              Знак под счётом — насколько равны были команды. Считается по остальным матчам
              игроков, поэтому от результата самой встречи не зависит: острие смотрит на команду
              послабее, а чем больше символов, тем крупнее перекос. «=» — команды были равны.
            </p>
          )}

          {ratingByMatch.size > 0 && (
            <p className="text-xs leading-relaxed text-muted">
              Числа под составами — клубный рейтинг на момент, когда матч доиграли: «⌀» — средний
              по паре, ниже — каждый игрок. Рядом с каждым числом то, насколько его сдвинул этот
              матч. Сыгранное позже эти числа уже не меняет.
            </p>
          )}

          {mayManage && extra >= MIN_ROUNDS && (
            <div className="pt-1">
              {extending ? (
                <div className="card p-4">
                  <p className="mb-1 text-sm font-semibold">Сколько раундов добавить?</p>
                  <p className="mb-3 text-sm text-muted">
                    {tournament.format === 'mexicano'
                      ? 'Составы соберутся по таблице — каждый следующий раунд, когда доигран предыдущий.'
                      : 'Пары подберутся заново — так, чтобы поменьше повторять уже сыгранные.'}
                  </p>

                  <div className="mb-4 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setExtraRounds(Math.max(MIN_ROUNDS, extra - 1))}
                      disabled={extra <= MIN_ROUNDS}
                      className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center text-3xl font-bold tabular-nums">
                      {extra}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExtraRounds(Math.min(maxExtra, extra + 1))}
                      disabled={extra >= maxExtra}
                      className="tap w-14 rounded-xl border border-line text-xl font-bold disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => addRounds(extra)}
                      className="tap flex-1 rounded-xl bg-accent px-4 font-bold text-accent-ink"
                    >
                      Добавить
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtending(false)}
                      className="tap flex-1 rounded-xl border border-line px-4 font-medium text-muted"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setExtending(true)}
                  className="tap w-full rounded-xl border border-line px-4 text-sm font-medium text-muted"
                >
                  Продлить турнир
                </button>
              )}
            </div>
          )}

          {mayManage && !isFinished && remaining > 0 && (
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
                      className="tap flex-1 rounded-xl bg-accent px-4 font-bold text-accent-ink"
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
      ) : activeTab === 'dynamics' ? (
        <div className="flex flex-col gap-5">
          <section className="card p-3">
            <h2 className="mb-1 text-sm font-bold">Места по раундам</h2>
            <p className="mb-3 text-xs leading-relaxed text-muted">
              Линия на игрока, сверху — первое место. Призёры выделены цветом; нажмите на любого,
              чтобы проследить его путь.
            </p>
            <DynamicsChart history={history} />
          </section>

          {dynamics.length > 0 && <InsightCards insights={dynamics} />}
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
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-sm font-medium">{row.name}</span>
                    {/* Своей колонки дельта не получает: на телефоне их и так
                        пять, а рядом с именем она читается как подпись. */}
                    {(ratingDelta.get(row.playerId) ?? 0) !== 0 && (
                      <span
                        className={`shrink-0 text-[11px] font-semibold tabular-nums ${
                          ratingDelta.get(row.playerId)! > 0 ? 'text-accent' : 'text-muted'
                        }`}
                        title="Изменение рейтинга за турнир"
                      >
                        {ratingDelta.get(row.playerId)! > 0
                          ? `+${ratingDelta.get(row.playerId)}`
                          : ratingDelta.get(row.playerId)}
                      </span>
                    )}
                  </span>
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
            у кого лучше разница очков, затем — больше побед. Число рядом с именем — насколько
            турнир сдвинул клубный рейтинг игрока.
            {tournament.format === 'mexicano' && !isFinished &&
              ' По этому же порядку собирается следующий раунд: первая четвёрка играет на первом' +
                ' корте, первый с четвёртым против второго с третьим.'}
          </p>

          {insights.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                Как это было
              </h2>
              <InsightCards insights={insights} />
            </section>
          )}

          {playedCount > 0 && (
            <button
              type="button"
              onClick={() => setSharing(true)}
              className="tap rounded-xl border border-line px-4 font-semibold"
            >
              Поделиться картинкой
            </button>
          )}

          {mayCreate && (
            <Link
              href={`/tournaments/new?from=${tournament.id}`}
              className="tap flex items-center justify-center rounded-xl bg-accent px-4 font-bold text-accent-ink"
            >
              Новый турнир с этим составом
            </Link>
          )}

          <div className="pt-2">
            {!mayDelete ? null : confirmDelete ? (
              <div className="card p-4">
                <p className="mb-3 text-sm">Удалить турнир вместе со всеми результатами?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={remove}
                    className="tap flex-1 rounded-xl bg-warn px-4 font-bold text-ink"
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
          onSave={(s1, s2) => saveScore(editing.id, s1, s2)}
          onClear={() => saveScore(editing.id, null, null)}
          onClose={() => setEditingId(null)}
        />
      )}

      {sharing && <ShareResultsSheet data={shareData} onClose={() => setSharing(false)} />}
    </main>
  );
}
