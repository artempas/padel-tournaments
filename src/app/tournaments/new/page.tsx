import { redirect } from 'next/navigation';
import NewTournamentForm from '@/components/NewTournamentForm';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { listRoster } from '@/lib/roster';
import { loadTournament } from '@/lib/tournaments';
import { randomTournamentName } from '@/lib/tournament-names';

export const dynamic = 'force-dynamic';

export default async function NewTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const { from } = await searchParams;
  const roster = await listRoster(user.id);

  // `?from=<id>` repeats an earlier tournament: same people, same settings.
  let players: string[] | undefined;
  let courts: number | undefined;
  let pointsPerMatch: number | undefined;
  let repeatedFrom: string | null = null;

  if (from) {
    try {
      const source = await loadTournament(from, user.id);
      players = source.players.map((p) => p.name);
      courts = source.courts;
      pointsPerMatch = source.pointsPerMatch;
      repeatedFrom = source.name;
    } catch (err) {
      // A stale or foreign link just falls back to an empty form.
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }

  return (
    <NewTournamentForm
      // Generated here so server and client render the same first paint.
      initialName={randomTournamentName()}
      initialPlayers={players}
      initialCourts={courts}
      initialPointsPerMatch={pointsPerMatch}
      roster={roster}
      repeatedFrom={repeatedFrom}
    />
  );
}
