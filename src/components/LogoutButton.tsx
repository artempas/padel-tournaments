'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { purgeOfflineData } from '@/lib/offline';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        // Queued scores and cached pages belong to the account that is leaving.
        await purgeOfflineData().catch(() => {});
        router.replace('/');
        router.refresh();
      }}
      className="tap rounded-xl border border-line px-4 text-sm font-medium text-muted transition disabled:opacity-40"
    >
      Выйти
    </button>
  );
}
