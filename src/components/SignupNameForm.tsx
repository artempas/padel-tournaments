'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import { failureMessage, request } from '@/lib/request';

const NAME_MIN = 2;
const NAME_MAX = 40;

/**
 * Как называть человека, который только что вошёл через Яндекс.
 *
 * Спрашивается ровно один раз и только у нового: аккаунта до ответа не
 * существует, и логин Яндекса в турнирной таблице никого не устроит.
 * Подсказкой в поле стоит логин — принять его можно одним нажатием.
 */
export default function SignupNameForm({ suggestion }: { suggestion: string }) {
  const router = useRouter();
  const [name, setName] = useState(suggestion.slice(0, NAME_MAX));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const { next } = await request<{ next: string }>('/api/auth/yandex/signup', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      router.replace(next);
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, 'Не удалось создать аккаунт'));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <header className="text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl text-accent-ink">
          🎾
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Как вас зовут?</h1>
        <p className="mt-2 text-sm text-muted">
          Под этим именем вас увидят в расписании и в итоговой таблице. Поменять его потом нельзя,
          так что выбирайте то, по которому вас узнают в клубе.
        </p>
      </header>

      <div className="card p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Имя</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              autoFocus
              autoComplete="nickname"
              placeholder="Например, Артём"
              className="tap rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || name.trim().length < NAME_MIN}
            className="tap rounded-xl bg-accent px-4 font-bold text-accent-ink transition disabled:opacity-40"
          >
            {busy ? 'Создаём…' : 'Продолжить'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs leading-relaxed text-muted">
        Вход в приложение — через Яндекс ID. Аккаунт появится, когда вы нажмёте «Продолжить».
      </p>
    </main>
  );
}
