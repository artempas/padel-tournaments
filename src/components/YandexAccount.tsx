'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import YandexButton from './YandexButton';
import type { LinkedYandex } from '@/lib/oauth';
import { failureMessage, request } from '@/lib/request';

/**
 * Яндекс ID в профиле: привязать или отвязать.
 *
 * Привязка — та же ссылка на тот же роут, что и вход: разница только в том,
 * что нажимает её уже вошедший, и сервер это видит. Отвязка ходит запросом,
 * поэтому компонент клиентский.
 */
export default function YandexAccount({ linked }: { linked: LinkedYandex | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!linked) {
    return (
      <div className="card mt-4 p-4">
        <p className="font-semibold">Вход через Яндекс ID</p>
        <p className="mb-4 mt-1 text-sm text-muted">
          Привяжите Яндекс, чтобы входить им — passkey при этом останется.
        </p>
        <YandexButton next="/club/me" label="Привязать Яндекс ID" />
      </div>
    );
  }

  return (
    <div className="card mt-4 p-4">
      <p className="font-semibold">Вход через Яндекс ID</p>
      <p className="mt-1 break-all text-sm text-muted">
        Привязан {linked.email ?? linked.login ?? 'аккаунт Яндекса'}
      </p>

      {error && <p className="mt-3 text-sm text-warn">{error}</p>}

      <button
        type="button"
        disabled={busy || !linked.removable}
        title={
          linked.removable
            ? undefined
            : 'Это единственный способ войти в аккаунт — сначала создайте passkey'
        }
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await request('/api/auth/yandex', { method: 'DELETE' });
          } catch (failure) {
            setError(failureMessage(failure, 'Не удалось отвязать Яндекс ID'));
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
          Отвязать можно, когда у аккаунта появится passkey: иначе входить будет нечем.
        </p>
      )}
    </div>
  );
}
