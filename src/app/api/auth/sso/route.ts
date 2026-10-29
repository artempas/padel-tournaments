import { NextResponse, type NextRequest } from 'next/server';
import { json, requireUser, route } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { beginSsoHandshake, unlinkAccount } from '@/lib/oauth';
import { discover, ssoConfig } from '@/lib/sso';
import { noticePath, resolveOrigin, safeNext } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

/**
 * Начало входа через SSO. Устроено так же, как у Яндекса: навигация, а не
 * fetch, и намерение — войти или привязать — решается здесь и уезжает в куку.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const origin = resolveOrigin(request.headers, request.nextUrl.origin);
  const user = await getCurrentUser();
  const intent = user ? 'link' : 'login';
  const back = (notice: string) => {
    const url = new URL(noticePath(next, intent), origin);
    url.searchParams.set('sso', notice);
    return NextResponse.redirect(url);
  };

  const config = ssoConfig();
  if (!config) return back('off');

  // Сервер SSO не отвечает или SSO_ISSUER с опечаткой. Человеку — «сейчас
  // недоступен», подробности — в лог.
  let discovery;
  try {
    discovery = await discover(config);
  } catch (failure) {
    console.error('sso discovery failed', failure);
    return back('off');
  }

  const url = await beginSsoHandshake(config, discovery, { next, intent });

  return NextResponse.redirect(url);
}

/** Отвязка — тем же адресом, как и у Яндекса. */
export const DELETE = route(async () => {
  const user = await requireUser();
  const removed = await unlinkAccount(user.id, 'sso');

  if (!removed) {
    return json({ error: 'Это единственный способ войти в аккаунт — сначала добавьте другой' }, 409);
  }

  return json({ ok: true });
});
