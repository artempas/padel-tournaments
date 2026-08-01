import RosterView from '@/components/RosterView';
import { pageMembership } from '@/lib/club-page';
import { can } from '@/lib/permissions';
import { rosterStats } from '@/lib/roster';

export const dynamic = 'force-dynamic';

export default async function PlayersPage() {
  const { club, role } = await pageMembership();

  return (
    <RosterView
      initial={await rosterStats(club.id)}
      clubName={club.name}
      mayArchive={can(role, 'roster:archive')}
    />
  );
}
