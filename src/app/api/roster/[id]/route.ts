import { ApiError, json, route } from '@/lib/api';
import { requireMembership } from '@/lib/club-context';
import { can } from '@/lib/permissions';
import { archivePerson } from '@/lib/roster';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, context: Context) => {
  const { club, role } = await requireMembership();
  if (!can(role, 'roster:archive')) {
    throw new ApiError('Убирать игроков из списка могут администраторы клуба', 403);
  }

  const { id } = await context.params;
  await archivePerson(club.id, id);
  return json({ ok: true });
});
