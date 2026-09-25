import { cookies } from 'next/headers';
import { ApiError, json, readJson, route } from '@/lib/api';
import { CLUB_COOKIE, clearCurrentClub, requireMembershipIn } from '@/lib/club-context';
import { deleteClub, listMembers, updateClub, type UpdateClubInput } from '@/lib/clubs';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role, personId } = await requireMembershipIn(id);

  return json({ club, role, personId, members: await listMembers(club.id) });
});

export const PATCH = route(async (request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role } = await requireMembershipIn(id);

  if (!can(role, 'club:edit')) {
    throw new ApiError('Менять клуб могут администраторы', 403);
  }

  const body = await readJson<UpdateClubInput>(request);
  return json({ club: await updateClub(club.id, body) });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role } = await requireMembershipIn(id);

  if (!can(role, 'club:delete')) {
    throw new ApiError('Удалить клуб может только владелец', 403);
  }

  await deleteClub(club.id);

  // Cookie указывала бы на клуб, которого больше не существует. Читатель это
  // переживёт (он сверяется с базой), но чинить состояние лучше сразу.
  const store = await cookies();
  if (store.get(CLUB_COOKIE)?.value === club.id) await clearCurrentClub();

  return json({ ok: true });
});
