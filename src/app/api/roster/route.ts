import { json, route } from '@/lib/api';
import { requireMembership } from '@/lib/club-context';
import { rosterStats } from '@/lib/roster';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const { club } = await requireMembership();
  return json({ players: await rosterStats(club.id) });
});
