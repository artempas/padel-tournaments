import { json, requireUser, route } from '@/lib/api';
import { deleteTournament, loadTournament } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  return json({ tournament: await loadTournament(id, user.id) });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  await deleteTournament(id, user.id);
  return json({ ok: true });
});
