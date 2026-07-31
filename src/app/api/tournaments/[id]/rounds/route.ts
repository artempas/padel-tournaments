import { ApiError, json, readJson, requireUser, route } from '@/lib/api';
import { extendTournament } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Продлить турнир: доиграли запланированное, а расходиться рано. */
export const POST = route(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await readJson<{ rounds?: unknown }>(request);

  if (body.rounds === undefined) throw new ApiError('Поле rounds обязательно');

  return json({ tournament: await extendTournament(id, user.id, Number(body.rounds)) });
});
