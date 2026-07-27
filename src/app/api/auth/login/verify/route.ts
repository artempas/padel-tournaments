import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { ApiError, json, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import {
  consumeChallenge,
  findCredential,
  relyingParty,
  updateCredentialCounter,
} from '@/lib/webauthn';
import { createSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  const body = await readJson<{ response?: AuthenticationResponseJSON }>(request);
  if (!body.response) throw new ApiError('Отсутствует ответ аутентификатора');

  const pending = await consumeChallenge('authentication');
  if (!pending) throw new ApiError('Сессия входа истекла — попробуйте снова', 408);

  const stored = await findCredential(body.response.id);
  if (!stored) throw new ApiError('Passkey не зарегистрирован', 401);

  // When the challenge was bound to a specific user, the credential must be theirs.
  if (pending.userId && pending.userId !== stored.userId) {
    throw new ApiError('Passkey принадлежит другому пользователю', 401);
  }

  const { rpID, origins } = relyingParty();

  // A malformed or forged assertion makes the library throw — that is a
  // failed login, not a server fault.
  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: pending.challenge,
    expectedOrigin: origins,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: stored.id,
      publicKey: stored.publicKey,
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  }).catch(() => {
    throw new ApiError('Не удалось подтвердить passkey', 401);
  });

  if (!verification.verified) throw new ApiError('Не удалось подтвердить passkey', 401);

  await updateCredentialCounter(stored.id, verification.authenticationInfo.newCounter);

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, username: true, displayName: true },
  });
  if (!user) throw new ApiError('Пользователь не найден', 404);

  await createSession(user.id);

  return json({ user });
});
