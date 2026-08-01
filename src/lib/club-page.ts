import { redirect } from 'next/navigation';
import { getCurrentUser } from './auth';
import { currentMembership, type Membership } from './club-context';

/**
 * Вход и клуб для серверных страниц.
 *
 * Отдельный модуль от club-context намеренно: `redirect()` бросает особое
 * исключение, которое умеет разбирать только рендер страницы. В обработчике
 * запроса оно превратилось бы в 500, поэтому API ходит через
 * `requireMembership`, а страницы — сюда.
 *
 * Здесь же единственное место, которое разбирает «клубов нет». Состояние
 * редкое — в него попадает тот, кто отдал свой клуб и вышел отовсюду, — и
 * держать под него пустой экран в каждом разделе не стоит: один redirect на
 * создание клуба закрывает вопрос для всех страниц сразу.
 */
export async function pageMembership(): Promise<Membership> {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const membership = await currentMembership(user);
  if (!membership) redirect('/clubs/new');

  return membership;
}
