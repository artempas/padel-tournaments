import { json, requireUser, route } from '@/lib/api';
import { archivePerson } from '@/lib/roster';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  await archivePerson(user.id, id);
  return json({ ok: true });
});
