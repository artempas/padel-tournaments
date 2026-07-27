import { generateAuthenticationOptions } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { ApiError, json, readJson, route } from '@/lib/api';
import { normalizeKey } from '@/lib/normalize';
import { prisma } from '@/lib/prisma';
import { issueChallenge, relyingParty } from '@/lib/webauthn';
import { pruneExpired } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  const body = await readJson<{ username?: string }>(request).catch(() => ({ username: undefined }));
  const username = (body.username ?? '').trim();

  await pruneExpired();

  const { rpID } = relyingParty();
  let userId: string | undefined;
  let allowCredentials:
    | Array<{ id: string; transports?: AuthenticatorTransportFuture[] }>
    | undefined;

  // With no username the browser offers any discoverable passkey for this site.
  if (username) {
    const user = await prisma.user.findUnique({
      where: { usernameKey: normalizeKey(username) },
      select: { id: true, credentials: { select: { id: true, transports: true } } },
    });
    if (!user) throw new ApiError('Пользователь не найден', 404);
    if (user.credentials.length === 0) throw new ApiError('У пользователя нет passkey', 404);

    userId = user.id;
    allowCredentials = user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials,
  });

  await issueChallenge('authentication', options.challenge, { userId });

  return json({ options });
});
