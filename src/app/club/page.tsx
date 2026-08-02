import ClubView from '@/components/ClubView';
import { pageMembership } from '@/lib/club-page';
import { listMembers } from '@/lib/clubs';
import { activeInvite } from '@/lib/invites';
import { can } from '@/lib/permissions';
import { listClubPlayers } from '@/lib/roster';

export const dynamic = 'force-dynamic';

export default async function ClubPage() {
  const { club, role, user } = await pageMembership();

  // Действующая ссылка интересна только тем, кто вправе приглашать; остальным
  // и запрос делать незачем.
  const [members, players, invite] = await Promise.all([
    listMembers(club.id),
    listClubPlayers(club.id),
    can(role, 'member:invite') ? activeInvite(club.id) : null,
  ]);

  return (
    <ClubView
      club={club}
      role={role}
      meUserId={user.id}
      members={members}
      players={players}
      invite={invite}
    />
  );
}
