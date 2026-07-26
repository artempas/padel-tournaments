import { json, readJson, requireUser, route } from '@/lib/api';
import { createTournament, listTournaments, type CreateTournamentInput } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await requireUser();
  return json({ tournaments: await listTournaments(user.id) });
});

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = await readJson<CreateTournamentInput>(request);
  const id = await createTournament(user.id, body);
  return json({ id }, 201);
});
