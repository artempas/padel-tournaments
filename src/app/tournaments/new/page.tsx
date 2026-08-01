import { redirect } from 'next/navigation';
import NewTournamentForm from '@/components/NewTournamentForm';
import { ApiError } from '@/lib/api';
import { pageMembership } from '@/lib/club-page';
import { can } from '@/lib/permissions';
import { listRoster } from '@/lib/roster';
import { loadTournament } from '@/lib/tournaments';
import { randomTournamentName } from '@/lib/tournament-names';
import type { PlayableFormat } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function NewTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { club, role } = await pageMembership();
  // Участнику здесь делать нечего: API его всё равно не пустит, а пустая форма
  // с отказом в конце — худший способ об этом сообщить.
  if (!can(role, 'tournament:create')) redirect('/tournaments');

  const { from } = await searchParams;
  const roster = await listRoster(club.id);

  // `?from=<id>` repeats an earlier tournament: same people, same settings.
  let players: string[] | undefined;
  let courts: number | undefined;
  let pointsPerMatch: number | undefined;
  let format: PlayableFormat | undefined;
  let rounds: number | undefined;
  let repeatedFrom: string | null = null;

  if (from) {
    try {
      const source = await loadTournament(from, club.id);
      players = source.players.map((p) => p.name);
      courts = source.courts;
      pointsPerMatch = source.pointsPerMatch;
      // team_americano в базе возможен, но составить его пока нечем — такой
      // турнир повторяется американо, как и любой незнакомый формат.
      format = source.format === 'mexicano' ? 'mexicano' : 'americano';
      rounds = source.roundsPlanned ?? undefined;
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
      initialFormat={format}
      initialRounds={rounds}
      roster={roster}
      repeatedFrom={repeatedFrom}
    />
  );
}
