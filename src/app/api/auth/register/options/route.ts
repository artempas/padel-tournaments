import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { ApiError, json, readJson, route } from '@/lib/api';
import { queryOne } from '@/lib/db';
import { issueChallenge, relyingParty } from '@/lib/webauthn';
import { pruneExpired } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  const body = await readJson<{ username?: string }>(request);
  const username = (body.username ?? '').trim();

  if (username.length < 2 || username.length > 32) {
    throw new ApiError('Имя должно быть от 2 до 32 символов');
  }

  await pruneExpired();

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE lower(username) = lower($1)',
    [username],
  );
  if (existing) throw new ApiError('Такое имя уже занято', 409);

  // Reserve the id now so the authenticator's user handle equals users.id.
  const userHandle = randomUUID();
  const { rpID, rpName } = relyingParty();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(userHandle),
    userName: username,
    userDisplayName: username,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await issueChallenge('registration', options.challenge, { username, userHandle });

  return json({ options });
});
