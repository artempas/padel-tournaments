import { NextResponse, type NextRequest } from 'next/server';
import { createSession, getCurrentUser, pruneExpired } from '@/lib/auth';
import { beginSignup, linkYandex, signInWithYandex, takeHandshake } from '@/lib/oauth';
import { exchangeCode, fetchUserInfo, identityFrom, resolveOrigin, yandexConfig } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

/**
 * Возвращение с Яндекса.
 *
 * Всё, что здесь может пойти не так, кончается редиректом на экран, с которого
 * человек ушёл, и одним словом в адресной строке. Технических подробностей он
 * не увидит: они уходят в лог сервера, где от них есть польза.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Кука снимается первым делом и при любом исходе: попытка одноразовая, и
  // брошенная не должна пережить сама себя.
  const handshake = await takeHandshake();
  const next = handshake?.next ?? '/';
  const origin = resolveOrigin(request.headers, request.nextUrl.origin);

  const back = (notice: string) => {
    const url = new URL(next, origin);
    url.searchParams.set('yandex', notice);
    return NextResponse.redirect(url);
  };

  const error = params.get('error');
  if (error) {
    // access_denied — это не сбой, а человек, передумавший на экране согласия.
    if (error === 'access_denied') return back('denied');
    console.error('yandex authorize failed', error, params.get('error_description'));
    return back('failed');
  }

  const code = params.get('code');
  const state = params.get('state');

  // Куки нет или `state` не тот: либо между началом и возвращением прошло
  // больше десяти минут, либо коллбэк открыт не тем, кто начинал вход. Для
  // человека это одно и то же — начать заново.
  if (!code || !state || !handshake || state !== handshake.state) return back('expired');

  const config = yandexConfig();
  if (!config) return back('off');

  try {
    const token = await exchangeCode(config, code, handshake.verifier);
    const identity = identityFrom(await fetchUserInfo(token));

    if (handshake.intent === 'link') {
      const user = await getCurrentUser();
      // Сессия истекла, пока человек был на Яндексе. Новый аккаунт вместо
      // привязки — худшее, что можно сделать: он остался бы с двумя.
      if (!user) return back('session');

      return back(await linkYandex(user.id, identity));
    }

    const userId = await signInWithYandex(identity);

    // Незнакомый Яндекс — это не вход, а начало регистрации. Аккаунт заведётся,
    // когда человек назовёт себя: логин в турнирной таблице ему ни к чему.
    if (!userId) {
      await beginSignup(identity, next);
      await pruneExpired();
      return NextResponse.redirect(new URL('/welcome', origin));
    }

    await createSession(userId);
    await pruneExpired();

    // Вход состоялся — сообщать не о чем, дальше обычное приложение.
    return NextResponse.redirect(new URL(next, origin));
  } catch (failure) {
    console.error('yandex sign-in failed', failure);
    return back('failed');
  }
}
