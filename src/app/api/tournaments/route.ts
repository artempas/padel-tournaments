import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembership } from '@/lib/club-context';
import { can } from '@/lib/permissions';
import { createTournament, listTournaments, type CreateTournamentInput } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const { club } = await requireMembership();
  return json({ tournaments: await listTournaments(club.id) });
});

export const POST = route(async (request: Request) => {
  const { club, role, user } = await requireMembership();
  if (!can(role, 'tournament:create')) {
    throw new ApiError('Турниры создают администраторы клуба', 403);
  }

  const body = await readJson<CreateTournamentInput>(request);
  const id = await createTournament(club.id, user.id, body);
  return json({ id }, 201);
});
