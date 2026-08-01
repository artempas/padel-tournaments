import { json, route } from '@/lib/api';
import { requireMembershipIn, setCurrentClub } from '@/lib/club-context';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Сменить текущий клуб. Отдельный роут, потому что cookie умеет ставить
 * только обработчик запроса — серверные компоненты их не пишут.
 *
 * Членство проверяется здесь же: в cookie не должно попасть то, чего человеку
 * не показывают. Чтение её всё равно сверяется с базой, но класть туда заведомо
 * чужой клуб незачем.
 */
export const POST = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club } = await requireMembershipIn(id);

  await setCurrentClub(club.id);
  return json({ club });
});
