import { ApiError, json, route } from '@/lib/api';
import { requireMembershipIn } from '@/lib/club-context';
import { activeInvite, issueInvite, revokeInvites } from '@/lib/invites';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function requireInviter(id: string) {
  const membership = await requireMembershipIn(id);
  if (!can(membership.role, 'member:invite')) {
    throw new ApiError('Приглашать в клуб могут администраторы', 403);
  }
  return membership;
}

/** Есть ли действующая ссылка. Само значение здесь не вернуть — в базе хеш. */
export const GET = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club } = await requireInviter(id);
  return json({ invite: await activeInvite(club.id) });
});

/** Выпустить новую ссылку. Прежняя гаснет — действующая у клуба одна. */
export const POST = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, user } = await requireInviter(id);
  return json({ invite: await issueInvite(club.id, user.id) }, 201);
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club } = await requireInviter(id);
  await revokeInvites(club.id);
  return json({ ok: true });
});
