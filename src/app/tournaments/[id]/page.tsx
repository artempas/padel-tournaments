import { notFound, redirect } from 'next/navigation';
import TournamentView from '@/components/TournamentView';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { loadTournament } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const { id } = await params;

  try {
    const tournament = await loadTournament(id, user.id);
    return <TournamentView initial={tournament} />;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
