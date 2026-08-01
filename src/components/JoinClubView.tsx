'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ClubBadge from './ClubBadge';
import ThemeToggle from './ThemeToggle';
import type { InvitePreview } from '@/lib/invites';
import { failureMessage, request } from '@/lib/request';

/**
 * Экран приглашения: кем вы будете в этом клубе.
 *
 * Выбор обязателен — «войти и разобраться потом» здесь нет, потому что
 * участник клуба это всегда игрок клуба. Обычно нужный человек уже есть в
 * списке: клуб играл до того, как позвал.
 */
export default function JoinClubView({ token, preview }: { token: string; preview: InvitePreview }) {
  const router = useRouter();
  const [choice, setChoice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creating = choice === NEW;
  const ready = creating ? newName.trim().length > 0 : choice !== null;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/invites/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify(creating ? { newName: newName.trim() } : { personId: choice }),
      });
      router.replace('/tournaments');
      router.refresh();
    } catch (err) {
      setError(failureMessage(err, 'Не удалось вступить в клуб'));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-6 sm:px-6">
      <div className="mb-6 flex justify-end">
        <ThemeToggle />
      </div>

      <header className="mb-6 flex flex-col items-center text-center">
        <ClubBadge icon={preview.club.icon} color={preview.club.color} size="lg" />
        <h1 className="mt-3 text-2xl font-bold">{preview.club.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {preview.alreadyMember
            ? 'Вы уже состоите в этом клубе'
            : 'Вас пригласили в клуб. Кто вы среди игроков?'}
        </p>
      </header>

      {preview.alreadyMember ? (
        <button
          type="button"
          onClick={() => {
            router.replace('/tournaments');
            router.refresh();
          }}
          className="tap w-full rounded-xl bg-accent px-4 font-bold text-accent-ink"
        >
          Открыть клуб
        </button>
      ) : (
        <>
          {preview.free.length > 0 && (
            <div className="card mb-3 overflow-hidden">
              <ul className="divide-y divide-line/70">
                {preview.free.map((player) => (
                  <li key={player.id}>
                    <button
                      type="button"
                      onClick={() => setChoice(player.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          choice === player.id
                            ? 'border-accent bg-accent text-accent-ink'
                            : 'border-line'
                        }`}
                      >
                        {choice === player.id ? '✓' : ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {player.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card mb-4 overflow-hidden">
            <button
              type="button"
              onClick={() => setChoice(NEW)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  creating ? 'border-accent bg-accent text-accent-ink' : 'border-line'
                }`}
              >
                {creating ? '✓' : ''}
              </span>
              <span className="text-sm font-medium">Меня здесь ещё нет</span>
            </button>

            {creating && (
              <div className="border-t border-line px-4 py-3">
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-muted">Как вас записывать</span>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    maxLength={40}
                    placeholder="Имя"
                    className="tap rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            )}
          </div>

          {error && (
            <p className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={busy || !ready}
            onClick={join}
            className="tap w-full rounded-xl bg-accent px-4 font-bold text-accent-ink transition disabled:opacity-40"
          >
            {busy ? 'Вступаем…' : 'Вступить в клуб'}
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted">
            Выбрав себя среди игроков, вы получите всю свою историю в этом клубе: матчи, очки и
            рейтинг.
          </p>
        </>
      )}
    </main>
  );
}

/** Псевдо-выбор «меня здесь ещё нет»: id игрока — uuid, спутать нельзя. */
const NEW = 'new';
