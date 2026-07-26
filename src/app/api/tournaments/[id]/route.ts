import { ApiError, json, readJson, requireUser, route } from '@/lib/api';
import { deleteTournament, loadTournament, setTournamentClosed } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  return json({ tournament: await loadTournament(id, user.id) });
});

/** Finish a tournament early, or resume one that was finished early. */
export const PATCH = route(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await readJson<{ closedEarly?: unknown }>(request);

  if (typeof body.closedEarly !== 'boolean') {
    throw new ApiError('Поле closedEarly должно быть true или false');
  }

  return json({ tournament: await setTournamentClosed(id, user.id, body.closedEarly) });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  await deleteTournament(id, user.id);
  return json({ ok: true });
});
