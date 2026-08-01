'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ClubBadge from './ClubBadge';
import ThemeToggle from './ThemeToggle';
import type { ClubBrief } from '@/lib/club-context';
import { CLUB_COLORS, CLUB_ICONS, CLUB_NAME_MAX } from '@/lib/club-style';
import type { ClubMemberRow } from '@/lib/clubs';
import {
  can,
  canAssignRole,
  canRemoveMember,
  ROLE_LABELS,
  type ClubRole,
} from '@/lib/permissions';
import { failureMessage, request } from '@/lib/request';
import type { RosterPlayer } from '@/lib/roster';

type Tab = 'players' | 'members';

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export interface ClubViewProps {
  club: ClubBrief;
  role: ClubRole;
  /** Аккаунт, который смотрит: чтобы не предлагать управлять собой. */
  meUserId: string;
  members: ClubMemberRow[];
  /** Весь ростер клуба, включая тех, за кем никто не стоит. */
  players: Array<RosterPlayer & { linked: boolean }>;
  /** Действующая ссылка есть — но её значение известно только в момент выпуска. */
  inviteExpiresAt: string | null;
}

export default function ClubView({
  club,
  role,
  meUserId,
  members,
  players,
  inviteExpiresAt,
}: ClubViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('players');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(club.name);
  const [icon, setIcon] = useState(club.icon);
  const [color, setColor] = useState(club.color);

  async function act(
    run: () => Promise<unknown>,
    message: string,
    after: 'refresh' | 'home' = 'refresh',
  ) {
    setBusy(true);
    setError(null);
    try {
      await run();
      if (after === 'home') {
        router.replace('/tournaments');
      }
      router.refresh();
    } catch (err) {
      setError(failureMessage(err, message));
    } finally {
      setBusy(false);
    }
  }

  async function issueLink() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { invite } = await request<{ invite: { token: string } }>(
        `/api/clubs/${club.id}/invite`,
        { method: 'POST' },
      );
      const url = `${window.location.origin}/join/${invite.token}`;
      setLink(url);
      // Буфер обмена может быть закрыт разрешениями — тогда ссылка просто
      // остаётся на экране, и её выделяют руками.
      await navigator.clipboard?.writeText(url).then(
        () => setCopied(true),
        () => {},
      );
      router.refresh();
    } catch (err) {
      setError(failureMessage(err, 'Не удалось выпустить ссылку'));
    } finally {
      setBusy(false);
    }
  }

  const mayInvite = can(role, 'member:invite');
  const mayTransfer = can(role, 'club:transfer');
  const mayLeave = can(role, 'club:leave');
  const mayEdit = can(role, 'club:edit');

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
        <ClubBadge icon={editing ? icon : club.icon} color={editing ? color : club.color} />
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{club.name}</h1>
        {mayEdit && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="tap shrink-0 rounded-xl border border-line px-3 text-sm text-muted"
          >
            {editing ? 'Отмена' : 'Изменить'}
          </button>
        )}
        <ThemeToggle />
      </header>

      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () =>
                request(`/api/clubs/${club.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ name: name.trim(), icon, color }),
                }),
              'Не удалось сохранить клуб',
            ).then(() => setEditing(false));
          }}
          className="card mb-4 flex flex-col gap-4 p-4"
        >
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Название</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={CLUB_NAME_MAX}
              className="tap rounded-xl border border-line bg-ink px-4 text-text focus:border-accent focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-8 gap-1.5">
            {CLUB_ICONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setIcon(option)}
                aria-label={`Значок ${option}`}
                aria-pressed={icon === option}
                className={`flex h-10 items-center justify-center rounded-lg text-lg transition ${
                  icon === option ? 'bg-surface-2 ring-2 ring-accent' : 'bg-ink'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {CLUB_COLORS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setColor(option.id)}
                aria-label={option.label}
                aria-pressed={color === option.id}
                className={`h-10 w-10 rounded-lg transition ${option.swatch} ${
                  color === option.id ? 'ring-2 ring-text ring-offset-2 ring-offset-ink' : ''
                }`}
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="tap rounded-xl bg-accent px-4 font-bold text-accent-ink disabled:opacity-40"
          >
            Сохранить
          </button>
        </form>
      )}

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        {(
          [
            ['players', `Игроки · ${players.length}`],
            ['members', `Участники · ${members.length}`],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`tap rounded-lg px-3 text-sm font-semibold transition ${
              tab === id ? 'bg-surface-2 text-text' : 'text-muted'
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

      {tab === 'players' ? (
        <>
          <div className="card overflow-hidden">
            <ul className="divide-y divide-line/70">
              {players.map((player) => (
                <li key={player.id} className="flex items-center gap-2 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {player.name}
                  </span>
                  {player.linked && (
                    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                      аккаунт
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            Игроки заводятся сами, когда вы вписываете имена в новый турнир. Пометка «аккаунт»
            значит, что игрока занял кто-то из участников клуба — остальные анонимны. Рейтинг и
            общий счёт — на странице{' '}
            <Link href="/players" className="underline underline-offset-2">
              Игроки
            </Link>
            .
          </p>
        </>
      ) : (
        <>
          {mayInvite && (
            <div className="card mb-4 p-4">
              <h2 className="font-semibold">Пригласить в клуб</h2>
              <p className="mt-1 text-sm text-muted">
                {inviteExpiresAt
                  ? // Точки в конце нет: русский формат Intl уже кончается на «г.»
                    `Ссылка действует до ${dateFormat.format(new Date(inviteExpiresAt))}`
                  : 'Действующей ссылки нет.'}{' '}
                По ней можно вступить сколько угодно раз, всегда участником.
              </p>

              {link && (
                <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 p-3">
                  <p className="mb-1 text-xs font-semibold text-accent">
                    {copied ? 'Ссылка скопирована' : 'Скопируйте ссылку — второй раз её не показать'}
                  </p>
                  <p className="break-all font-mono text-xs">{link}</p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={issueLink}
                  className="tap rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink disabled:opacity-40"
                >
                  {inviteExpiresAt ? 'Выпустить новую' : 'Выпустить ссылку'}
                </button>
                {inviteExpiresAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setLink(null);
                      void act(
                        () => request(`/api/clubs/${club.id}/invite`, { method: 'DELETE' }),
                        'Не удалось отозвать ссылку',
                      );
                    }}
                    className="tap rounded-xl border border-line px-4 text-sm font-medium text-muted disabled:opacity-40"
                  >
                    Отозвать
                  </button>
                )}
              </div>

              {/* Ссылку хранит только тот, кому её выдали: в базе лежит хеш —
                  как у сессий. Поэтому «показать ещё раз» здесь нет. */}
              <p className="mt-2 text-xs text-muted">
                Выпуск новой ссылки гасит прежнюю.
              </p>
            </div>
          )}

          <div className="card overflow-hidden">
            <ul className="divide-y divide-line/70">
              {members.map((member) => {
                const isMe = member.userId === meUserId;
                const mayChange = canAssignRole(role, member.role, 'admin');
                const mayRemove = canRemoveMember(role, member.role);

                return (
                  <li key={member.userId} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {member.playerName}
                          {isMe && <span className="ml-1 text-muted">— это вы</span>}
                        </span>
                        <span className="block text-xs text-muted">
                          {ROLE_LABELS[member.role]} · с{' '}
                          {dateFormat.format(new Date(member.joinedAt))}
                        </span>
                      </span>
                    </div>

                    {(mayChange || mayRemove) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {mayChange && (
                          <select
                            value={member.role}
                            disabled={busy}
                            onChange={(e) =>
                              act(
                                () =>
                                  request(`/api/clubs/${club.id}/members/${member.userId}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ role: e.target.value }),
                                  }),
                                'Не удалось сменить роль',
                              )
                            }
                            className="tap rounded-lg border border-line bg-ink px-3 text-xs font-semibold text-text focus:border-accent focus:outline-none"
                          >
                            <option value="member">{ROLE_LABELS.member}</option>
                            <option value="admin">{ROLE_LABELS.admin}</option>
                          </select>
                        )}

                        {mayTransfer && !isMe && (
                          transferTo === member.userId ? (
                            <span className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () =>
                                      request(`/api/clubs/${club.id}/transfer`, {
                                        method: 'POST',
                                        body: JSON.stringify({ userId: member.userId }),
                                      }),
                                    'Не удалось передать клуб',
                                  )
                                }
                                className="tap rounded-lg bg-warn px-3 text-xs font-bold text-ink"
                              >
                                Передать клуб
                              </button>
                              <button
                                type="button"
                                onClick={() => setTransferTo(null)}
                                className="tap rounded-lg border border-line px-3 text-xs text-muted"
                              >
                                Отмена
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setTransferTo(member.userId)}
                              className="text-xs text-muted underline underline-offset-2"
                            >
                              Сделать владельцем
                            </button>
                          )
                        )}

                        {mayRemove &&
                          (confirmRemove === member.userId ? (
                            <span className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () =>
                                      request(`/api/clubs/${club.id}/members/${member.userId}`, {
                                        method: 'DELETE',
                                      }),
                                    'Не удалось удалить участника',
                                  )
                                }
                                className="tap rounded-lg bg-danger px-3 text-xs font-bold text-ink"
                              >
                                Удалить
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemove(null)}
                                className="tap rounded-lg border border-line px-3 text-xs text-muted"
                              >
                                Отмена
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmRemove(member.userId)}
                              className="text-xs text-danger underline underline-offset-2"
                            >
                              Удалить из клуба
                            </button>
                          ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            Участник смотрит турниры клуба и вносит счёт в матчи, где играет сам. Администратор
            заводит турниры, правит любой счёт, завершает и продлевает их, зовёт новых участников.
            Владелец может ещё удалять участников и турниры.
          </p>
        </>
      )}

      <div className="mt-6">
        {mayLeave ? (
          confirmLeave ? (
            <div className="card p-4">
              <p className="text-sm">
                Выйти из клуба «{club.name}»? Ваш игрок останется в ростере со всей историей, но
                снова станет анонимным. Вернуться можно только по новой ссылке-приглашению.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => request(`/api/clubs/${club.id}/membership`, { method: 'DELETE' }),
                      'Не удалось выйти из клуба',
                      'home',
                    )
                  }
                  className="tap flex-1 rounded-xl bg-danger px-4 text-sm font-bold text-ink disabled:opacity-40"
                >
                  Выйти из клуба
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmLeave(false)}
                  className="tap flex-1 rounded-xl border border-line px-4 text-sm font-medium text-muted"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="text-sm text-muted underline underline-offset-2"
            >
              Выйти из клуба
            </button>
          )
        ) : (
          <p className="text-xs text-muted">
            Владелец не может выйти из клуба — сначала передайте его другому участнику на вкладке
            «Участники».
          </p>
        )}
      </div>
    </main>
  );
}
