import { cookies } from 'next/headers';
import { queryOne, query } from './db';

export const CHALLENGE_COOKIE = 'padel_webauthn';
const CHALLENGE_TTL_MS = 5 * 60_000;

export type ChallengeKind = 'registration' | 'authentication';

export interface RelyingParty {
  rpID: string;
  rpName: string;
  origins: string[];
}

export function relyingParty(): RelyingParty {
  const rpID = process.env.RP_ID;
  const origin = process.env.ORIGIN;
  if (!rpID || !origin) {
    throw new Error('RP_ID and ORIGIN must be set — see .env.example');
  }
  return {
    rpID,
    rpName: process.env.RP_NAME || 'Padel Tournaments',
    origins: origin.split(',').map((o) => o.trim()).filter(Boolean),
  };
}

/**
 * Challenges live in the database, never in the cookie — the cookie only
 * carries an opaque row id. A client therefore cannot pick its own challenge,
 * which is what makes a captured assertion useless for replay.
 */
export async function issueChallenge(
  kind: ChallengeKind,
  challenge: string,
  meta: { userId?: string; username?: string; userHandle?: string } = {},
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO webauthn_challenges (challenge, kind, user_id, username, user_handle, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' milliseconds')::interval)
     RETURNING id`,
    [
      challenge,
      kind,
      meta.userId ?? null,
      meta.username ?? null,
      meta.userHandle ?? null,
      String(CHALLENGE_TTL_MS),
    ],
  );

  const store = await cookies();
  store.set(CHALLENGE_COOKIE, row!.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

export interface ConsumedChallenge {
  challenge: string;
  userId: string | null;
  username: string | null;
  userHandle: string | null;
}

/** Reads and deletes the pending challenge — single use by construction. */
export async function consumeChallenge(kind: ChallengeKind): Promise<ConsumedChallenge | null> {
  const store = await cookies();
  const id = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!id) return null;

  const row = await queryOne<{
    challenge: string;
    user_id: string | null;
    username: string | null;
    user_handle: string | null;
  }>(
    `DELETE FROM webauthn_challenges
      WHERE id = $1 AND kind = $2 AND expires_at > now()
      RETURNING challenge, user_id, username, user_handle`,
    [id, kind],
  );

  if (!row) return null;
  return {
    challenge: row.challenge,
    userId: row.user_id,
    username: row.username,
    userHandle: row.user_handle,
  };
}

export interface StoredCredential {
  id: string;
  userId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

export async function findCredential(credentialId: string): Promise<StoredCredential | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    public_key: Buffer;
    counter: string;
    transports: string[];
  }>('SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = $1', [
    credentialId,
  ]);

  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    // `from` (not `new`) so the buffer type is a plain ArrayBuffer, which is
    // what @simplewebauthn/server's WebAuthnCredential expects.
    publicKey: Uint8Array.from(row.public_key),
    counter: Number(row.counter),
    transports: row.transports,
  };
}

export async function updateCredentialCounter(id: string, counter: number): Promise<void> {
  await query('UPDATE credentials SET counter = $2, last_used_at = now() WHERE id = $1', [
    id,
    counter,
  ]);
}
