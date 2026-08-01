import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembershipIn } from '@/lib/club-context';
import { transferOwnership } from '@/lib/clubs';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Передать клуб. Бывший владелец остаётся администратором. */
export const POST = route(async (request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role, user } = await requireMembershipIn(id);

  if (!can(role, 'club:transfer')) {
    throw new ApiError('Передать клуб может только его владелец', 403);
  }

  const body = await readJson<{ userId?: unknown }>(request);
  if (typeof body.userId !== 'string') throw new ApiError('Поле userId обязательно');

  await transferOwnership(club.id, user.id, body.userId);
  return json({ ok: true });
});
