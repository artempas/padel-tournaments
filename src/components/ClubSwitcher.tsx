'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ClubBadge from './ClubBadge';
import type { ClubBrief } from '@/lib/club-context';
import { ROLE_LABELS, type ClubRole } from '@/lib/permissions';
import { failureMessage, request } from '@/lib/request';

export interface ClubOption extends ClubBrief {
  role: ClubRole;
}

/**
 * Выбор клуба в шапке.
 *
 * Не `<select>`, в отличие от сортировки в списке игроков: там варианты —
 * слова, а здесь у каждого клуба свой значок, и нативный список показать его
 * не может. Клуб человек меняет несколько раз в жизни, так что лишний тап по
 * своему меню ничего не стоит.
 *
 * Переключение ходит на сервер: текущий клуб живёт в httpOnly-cookie, и
 * поставить её может только обработчик запроса.
 */
export default function ClubSwitcher({
  current,
  clubs,
}: {
  current: ClubBrief;
  clubs: ClubOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Клик мимо и Escape закрывают меню: на телефоне промах по кнопке — обычное
  // дело, и меню, которое не закрыть, раздражает больше, чем помогает.
  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function choose(id: string) {
    if (id === current.id) {
      setOpen(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await request(`/api/clubs/${id}/switch`, { method: 'POST' });
      setOpen(false);
      // Все данные на экране — клубные, поэтому перерисовывается страница
      // целиком, а не одна шапка.
      router.refresh();
    } catch (err) {
      setError(failureMessage(err, 'Не удалось сменить клуб', 'Нет сети — смена клуба требует связи'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        className="tap flex w-full min-w-0 items-center gap-2 rounded-xl border border-line px-2 pr-3 text-left disabled:opacity-50"
      >
        <ClubBadge icon={current.icon} color={current.color} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.name}</span>
        <span aria-hidden="true" className="shrink-0 text-xs text-muted">
          ▾
        </span>
      </button>

      {error && (
        <p className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-warn/40 bg-ink px-3 py-2 text-xs text-warn">
          {error}
        </p>
      )}

      {open && (
        <div
          role="menu"
          className="card absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden p-1 shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto">
            {clubs.map((club) => (
              <li key={club.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => choose(club.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                    club.id === current.id ? 'bg-surface-2' : ''
                  }`}
                >
                  <ClubBadge icon={club.icon} color={club.color} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{club.name}</span>
                    <span className="block text-xs text-muted">{ROLE_LABELS[club.role]}</span>
                  </span>
                  {club.id === current.id && (
                    <span aria-hidden="true" className="shrink-0 text-accent">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <Link
            href="/clubs/new"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 border-t border-line px-2 py-2.5 text-sm font-semibold text-accent"
          >
            <span aria-hidden="true" className="w-7 text-center text-lg">
              +
            </span>
            Создать клуб
          </Link>
        </div>
      )}
    </div>
  );
}
