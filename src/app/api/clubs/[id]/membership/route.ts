import { ApiError, json, route } from '@/lib/api';
import { clearCurrentClub, CLUB_COOKIE, requireMembershipIn } from '@/lib/club-context';
import { removeMember } from '@/lib/clubs';
import { can } from '@/lib/permissions';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Выйти из клуба самому.
 *
 * Игрок при этом остаётся в ростере со всей историей — снимается только связь
 * с аккаунтом, и клуб видит его снова анонимным. Вернуться можно по новой
 * ссылке-приглашению; узнавать себя придётся заново, из списка.
 */
export const DELETE = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role, user } = await requireMembershipIn(id);

  if (!can(role, 'club:leave')) {
    throw new ApiError('Владелец не может выйти — сначала передайте клуб другому участнику');
  }

  await removeMember(club.id, user.id);

  // Cookie указывала бы на клуб, которого у человека больше нет. Читатель это
  // переживёт (он сверяется с базой), но чинить состояние лучше сразу.
  const store = await cookies();
  if (store.get(CLUB_COOKIE)?.value === club.id) await clearCurrentClub();

  return json({ ok: true });
});
