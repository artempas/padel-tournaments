import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { ApiError, json, readJson, route } from '@/lib/api';
import { normalizeKey } from '@/lib/normalize';
import { prisma } from '@/lib/prisma';
import { consumeChallenge, relyingParty } from '@/lib/webauthn';
import { createSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  const body = await readJson<{ response?: RegistrationResponseJSON }>(request);
  if (!body.response) throw new ApiError('Отсутствует ответ аутентификатора');

  const pending = await consumeChallenge('registration');
  if (!pending?.username || !pending.userHandle) {
    throw new ApiError('Сессия регистрации истекла — начните заново', 408);
  }

  const { rpID, origins } = relyingParty();

  // A malformed or forged attestation makes the library throw — that is a
  // rejected credential, not a server fault.
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: pending.challenge,
    expectedOrigin: origins,
    expectedRPID: rpID,
    requireUserVerification: false,
  }).catch(() => {
    throw new ApiError('Не удалось подтвердить passkey', 401);
  });

  if (!verification.verified) throw new ApiError('Не удалось подтвердить passkey', 401);

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Вложенный create — одна транзакция: пользователь без passkey не появится,
  // даже если вторая вставка упадёт. Занятое имя ловим по нарушению
  // уникальности usernameKey, а не отдельной проверкой перед вставкой.
  const user = await prisma.user
    .create({
      data: {
        id: pending.userHandle,
        username: pending.username,
        usernameKey: normalizeKey(pending.username),
        displayName: pending.username,
        credentials: {
          create: {
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey),
            counter: BigInt(credential.counter),
            transports: credential.transports ?? [],
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
          },
        },
      },
      select: { id: true, username: true, displayName: true },
    })
    .catch((err: unknown) => {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        throw new ApiError('Такое имя уже занято', 409);
      }
      throw err;
    });

  await createSession(user.id);

  return json({ user });
});
