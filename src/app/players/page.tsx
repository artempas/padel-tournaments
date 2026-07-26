import { redirect } from 'next/navigation';
import RosterView from '@/components/RosterView';
import { getCurrentUser } from '@/lib/auth';
import { rosterStats } from '@/lib/roster';

export const dynamic = 'force-dynamic';

export default async function PlayersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  return <RosterView initial={await rosterStats(user.id)} />;
}
