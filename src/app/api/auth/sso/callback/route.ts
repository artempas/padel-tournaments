import { NextResponse, type NextRequest } from 'next/server';
import { createSession, getCurrentUser, pruneExpired } from '@/lib/auth';
import { beginSignup, linkAccount, signInWith, takeHandshake } from '@/lib/oauth';
import {
  decodeIdToken,
  discover,
  exchangeCode,
  fetchClaims,
  identityFrom,
  ssoConfig,
  verifyIdToken,
} from '@/lib/sso';
import { noticePath, resolveOrigin } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

/**
 * Возвращение с SSO. Исходы и их обработка — те же, что у Яндекса (см.
 * api/auth/yandex/callback): любая неудача кончается редиректом туда, откуда
 * человек ушёл, с одним словом в адресе, а подробности уходят в лог.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const handshake = await takeHandshake('sso');
  const next = handshake?.next ?? '/';
  const origin = resolveOrigin(request.headers, request.nextUrl.origin);

  const back = (notice: string) => {
    const url = new URL(noticePath(next, handshake?.intent ?? 'login'), origin);
    url.searchParams.set('sso', notice);
    return NextResponse.redirect(url);
  };

  const error = params.get('error');
  if (error) {
    if (error === 'access_denied') return back('denied');
    console.error('sso authorize failed', error, params.get('error_description'));
    return back('failed');
  }

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || !handshake?.nonce || state !== handshake.state) return back('expired');

  const config = ssoConfig();
  if (!config) return back('off');

  try {
    const discovery = await discover(config);
    const tokens = await exchangeCode(config, discovery, code, handshake.verifier);

    const idClaims = decodeIdToken(tokens.idToken);
    const subject = verifyIdToken(idClaims, {
      issuer: discovery.issuer,
      clientId: config.clientId,
      nonce: handshake.nonce,
    });
    const identity = identityFrom(subject, await fetchClaims(discovery, tokens, subject, idClaims));

    if (handshake.intent === 'link') {
      const user = await getCurrentUser();
      if (!user) return back('session');

      return back(await linkAccount('sso', user.id, identity));
    }

    const userId = await signInWith('sso', identity);

    if (!userId) {
      await beginSignup('sso', identity, next);
      await pruneExpired();
      return NextResponse.redirect(new URL('/welcome', origin));
    }

    await createSession(userId);
    await pruneExpired();

    return NextResponse.redirect(new URL(next, origin));
  } catch (failure) {
    console.error('sso sign-in failed', failure);
    return back('failed');
  }
}
