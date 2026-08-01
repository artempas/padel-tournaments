'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ClubBadge from './ClubBadge';
import ThemeToggle from './ThemeToggle';
import { CLUB_COLORS, CLUB_ICONS, CLUB_NAME_MAX } from '@/lib/club-style';
import { failureMessage, request } from '@/lib/request';

/**
 * Создание клуба.
 *
 * Имя игрока спрашивается здесь, а не потом: участник клуба — это всегда и
 * игрок клуба, иначе ему нечего показать в своём профиле и не за что
 * зацепиться статистике. Владелец не исключение.
 */
export default function NewClubForm({
  displayName,
  first,
}: {
  /** Имя аккаунта — разумная заготовка для имени игрока. */
  displayName: string;
  /** Клубов у человека нет вообще: тогда уходить с этого экрана некуда. */
  first: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(CLUB_ICONS[0]);
  const [color, setColor] = useState<string>(CLUB_COLORS[0].id);
  const [playerName, setPlayerName] = useState(displayName.slice(0, 40));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim().length > 0 && playerName.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request<{ id: string }>('/api/clubs', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), icon, color, playerName: playerName.trim() }),
      });
      // Сервер уже переключил текущий клуб на новый — остаётся показать его.
      router.replace('/tournaments');
      router.refresh();
    } catch (err) {
      setError(failureMessage(err, 'Не удалось создать клуб', 'Нет сети — создание клуба требует связи'));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        {first ? (
          <span className="w-11 shrink-0" />
        ) : (
          <Link
            href="/tournaments"
            className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted"
            aria-label="Назад"
          >
            ←
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Новый клуб</h1>
        <ThemeToggle />
      </header>

      {first && (
        <p className="card mb-4 px-4 py-3 text-sm text-muted">
          Клуб — это общий ростер, турниры и рейтинг. Заведите свой или попросите ссылку-приглашение
          у того, кто вас зовёт.
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="card flex items-center gap-4 p-4">
          <ClubBadge icon={icon} color={color} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{name.trim() || 'Название клуба'}</p>
            <p className="text-sm text-muted">Так клуб будет выглядеть в списке</p>
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">Название</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={CLUB_NAME_MAX}
            placeholder="Например, Вторничный падел"
            className="tap rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">Значок</span>
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
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">Цвет</span>
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
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">Ваше имя как игрока</span>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={40}
            className="tap rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
          />
          <span className="text-xs text-muted">
            Под этим именем вы попадёте в состав турниров и в таблицу клуба.
          </span>
        </label>

        {error && (
          <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !ready}
          className="tap rounded-xl bg-accent px-4 font-bold text-accent-ink transition disabled:opacity-40"
        >
          {busy ? 'Создаём…' : 'Создать клуб'}
        </button>
      </form>
    </main>
  );
}
