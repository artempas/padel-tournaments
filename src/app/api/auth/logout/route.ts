import { json, route } from '@/lib/api';
import { destroySession } from '@/lib/auth';
import { clearCurrentClub } from '@/lib/club-context';

export const dynamic = 'force-dynamic';

export const POST = route(async () => {
  await destroySession();
  // Выбранный клуб принадлежит уходящему аккаунту — как и очередь счёта с
  // кэшем страниц, которые чистит сам клиент.
  await clearCurrentClub();
  return json({ ok: true });
});
