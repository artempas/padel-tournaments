'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { purgeOfflineData } from '@/lib/offline';
import { request } from '@/lib/request';

/**
 * Единственное действие, которое честно ждёт сервер. Показать выход, не
 * погасив сессию, — соврать про безопасность, а очередь счёта и кэш страниц
 * стирать до ответа тем более рано.
 */
export default function LogoutButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  return (
    <button
      type="button"
      disabled={state === 'busy'}
      aria-label={state === 'failed' ? 'Не удалось выйти — попробуйте ещё раз' : undefined}
      title={state === 'failed' ? 'Не удалось выйти — нужна связь с сервером' : undefined}
      onClick={async () => {
        setState('busy');
        try {
          await request('/api/auth/logout', { method: 'POST' });
        } catch {
          setState('failed');
          return;
        }
        // Queued scores and cached pages belong to the account that is leaving.
        await purgeOfflineData().catch(() => {});
        router.replace('/');
        router.refresh();
      }}
      className={`tap rounded-xl border px-4 text-sm font-medium transition disabled:opacity-40 ${
        state === 'failed' ? 'border-warn/50 text-warn' : 'border-line text-muted'
      }`}
    >
      {state === 'failed' ? 'Ещё раз' : 'Выйти'}
    </button>
  );
}
