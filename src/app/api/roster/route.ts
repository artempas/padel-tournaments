import { json, requireUser, route } from '@/lib/api';
import { rosterStats } from '@/lib/roster';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await requireUser();
  return json({ players: await rosterStats(user.id) });
});
