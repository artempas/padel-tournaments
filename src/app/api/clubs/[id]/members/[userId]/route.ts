import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembershipIn } from '@/lib/club-context';
import { removeMemberAs, setMemberRole } from '@/lib/clubs';
import type { ClubRole } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; userId: string }> };

const ROLES: ClubRole[] = ['member', 'admin', 'owner'];

export const PATCH = route(async (request: Request, context: Context) => {
  const { id, userId } = await context.params;
  const { club, role } = await requireMembershipIn(id);

  const body = await readJson<{ role?: unknown }>(request);
  const next = String(body.role ?? '');
  if (!ROLES.includes(next as ClubRole)) throw new ApiError('Неизвестная роль');

  // Кого и на что можно двигать, решает canAssignRole внутри: «не выше себя»
  // и «не трогать равного» — правила, а не проверки конкретного роута.
  await setMemberRole(club.id, role, userId, next as ClubRole);
  return json({ ok: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const { id, userId } = await context.params;
  const { club, role } = await requireMembershipIn(id);

  await removeMemberAs(club.id, role, userId);
  return json({ ok: true });
});
