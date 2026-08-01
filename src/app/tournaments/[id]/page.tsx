import { notFound, redirect } from 'next/navigation';
import TournamentView from '@/components/TournamentView';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { requireMembershipForTournament } from '@/lib/club-context';
import { loadTournament, myPlayerId } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const { id } = await params;

  try {
    // Права берутся от клуба самого турнира, а не от выбранного в селекторе:
    // ссылка на турнир должна открываться из любого клуба, где человек состоит.
    const { club, role, personId } = await requireMembershipForTournament(id);
    const [tournament, mine] = await Promise.all([
      loadTournament(id, club.id),
      myPlayerId(id, personId),
    ]);

    return <TournamentView initial={tournament} role={role} myPlayerId={mine} />;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
