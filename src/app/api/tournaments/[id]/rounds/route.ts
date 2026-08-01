import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembershipForTournament } from '@/lib/club-context';
import { can } from '@/lib/permissions';
import { extendTournament } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Продлить турнир: доиграли запланированное, а расходиться рано. */
export const POST = route(async (request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role } = await requireMembershipForTournament(id);

  if (!can(role, 'tournament:extend')) {
    throw new ApiError('Продлевать турнир могут администраторы клуба', 403);
  }

  const body = await readJson<{ rounds?: unknown }>(request);
  if (body.rounds === undefined) throw new ApiError('Поле rounds обязательно');

  return json({ tournament: await extendTournament(id, club.id, Number(body.rounds)) });
});
