import { NextResponse, type NextRequest } from 'next/server';
import { json, requireUser, route } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { beginYandexHandshake, unlinkYandex } from '@/lib/oauth';
import { safeNext, yandexConfig } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

/**
 * Начало входа через Яндекс ID.
 *
 * Обычная навигация, а не fetch: вся цепочка редиректов — наш роут, экран
 * согласия Яндекса, коллбэк — должна пройти в основном окне, иначе человеку
 * негде подтвердить доступ.
 *
 * Уже вошедший попадает сюда только из своего профиля, и для него это не вход,
 * а привязка. Что именно происходит, решается здесь, в начале: намерение
 * уезжает в куку рукопожатия и переживает поход на Яндекс.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const back = (notice: string) => {
    const url = new URL(next, request.nextUrl.origin);
    url.searchParams.set('yandex', notice);
    return NextResponse.redirect(url);
  };

  const config = yandexConfig();
  // Ключей нет — кнопки на экране входа тоже нет, значит сюда пришли по прямой
  // ссылке. Отвечать 500 не за что: вход просто не подключён.
  if (!config) return back('off');

  const user = await getCurrentUser();
  const url = await beginYandexHandshake(config, { next, intent: user ? 'link' : 'login' });

  return NextResponse.redirect(url);
}

/**
 * Отвязка. Тем же адресом, потому что это то же самое отношение — «у аккаунта
 * есть Яндекс», — только снимается.
 */
export const DELETE = route(async () => {
  const user = await requireUser();
  const removed = await unlinkYandex(user.id);

  if (!removed) {
    return json(
      { error: 'Это единственный способ войти в аккаунт — сначала создайте passkey' },
      409,
    );
  }

  return json({ ok: true });
});
