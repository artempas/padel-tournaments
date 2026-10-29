'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { LinkedAccount } from '@/lib/oauth';
import { failureMessage, request } from '@/lib/request';

/**
 * Внешний вход в профиле — Яндекс ID или SSO: привязать или отвязать.
 *
 * Привязка — та же ссылка на тот же роут, что и вход: разница только в том,
 * что нажимает её уже вошедший, и сервер это видит. Поэтому кнопку привязки
 * приносит страница — у каждого провайдера она своя. Отвязка ходит запросом
 * на тот же адрес, поэтому компонент клиентский.
 */
export default function LinkedAccountCard({
  title,
  hint,
  endpoint,
  linkButton,
  linked,
}: {
  /** «Вход через Яндекс ID». */
  title: string;
  /** Строка под заголовком, пока ничего не привязано. */
  hint: string;
  /** Роут провайдера: GET начинает привязку, DELETE отвязывает. */
  endpoint: string;
  linkButton: ReactNode;
  linked: LinkedAccount | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!linked) {
    return (
      <div className="card mt-4 p-4">
        <p className="font-semibold">{title}</p>
        <p className="mb-4 mt-1 text-sm text-muted">{hint}</p>
        {linkButton}
      </div>
    );
  }

  return (
    <div className="card mt-4 p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 break-all text-sm text-muted">
        Привязан {linked.email ?? linked.login ?? 'аккаунт'}
      </p>

      {error && <p className="mt-3 text-sm text-warn">{error}</p>}

      <button
        type="button"
        disabled={busy || !linked.removable}
        title={
          linked.removable
            ? undefined
            : 'Это единственный способ войти в аккаунт — сначала добавьте другой'
        }
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await request(endpoint, { method: 'DELETE' });
          } catch (failure) {
            setError(failureMessage(failure, 'Не удалось отвязать'));
            setBusy(false);
            return;
          }
          router.refresh();
          setBusy(false);
        }}
        className="tap mt-3 rounded-xl border border-line px-4 text-sm font-medium text-muted transition disabled:opacity-40"
      >
        Отвязать
      </button>

      {!linked.removable && (
        <p className="mt-2 text-xs text-muted">
          Отвязать можно, когда у аккаунта появится другой способ входа — passkey или ещё один
          провайдер: иначе входить будет нечем.
        </p>
      )}
    </div>
  );
}
