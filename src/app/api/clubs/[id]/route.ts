import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembershipIn } from '@/lib/club-context';
import { listMembers, updateClub, type UpdateClubInput } from '@/lib/clubs';
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
