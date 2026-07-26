import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { ApiError, json, readJson, route } from '@/lib/api';
import { transaction } from '@/lib/db';
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

  const user = await transaction(async (client) => {
    const inserted = await client.query<{ id: string; username: string; display_name: string }>(
      `INSERT INTO users (id, username, display_name)
       VALUES ($1, $2, $2)
       ON CONFLICT DO NOTHING
       RETURNING id, username, display_name`,
      [pending.userHandle, pending.username],
    );

    if (inserted.rowCount === 0) throw new ApiError('Такое имя уже занято', 409);

    await client.query(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        credential.id,
        pending.userHandle,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports ?? [],
        credentialDeviceType,
        credentialBackedUp,
      ],
    );

    return inserted.rows[0];
  });

  await createSession(user.id);

  return json({
    user: { id: user.id, username: user.username, displayName: user.display_name },
  });
});
