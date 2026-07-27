import { cookies } from 'next/headers';
import { prisma } from './prisma';
import type { ChallengeKind } from '@/generated/prisma/enums';

export const CHALLENGE_COOKIE = 'padel_webauthn';
const CHALLENGE_TTL_MS = 5 * 60_000;

export type { ChallengeKind };

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
  const row = await prisma.webauthnChallenge.create({
    data: {
      challenge,
      kind,
      userId: meta.userId ?? null,
      username: meta.username ?? null,
      userHandle: meta.userHandle ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
    select: { id: true },
  });

  const store = await cookies();
  store.set(CHALLENGE_COOKIE, row.id, {
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

  // Одноразовость обеспечивается тем, что удаление и есть чтение: это один
  // DELETE ... RETURNING, поэтому две параллельные попытки не могут обе
  // увидеть строку. Отсутствие строки Prisma сообщает исключением P2025.
  return prisma.webauthnChallenge
    .delete({
      where: { id, kind, expiresAt: { gt: new Date() } },
      select: { challenge: true, userId: true, username: true, userHandle: true },
    })
    .catch(() => null);
}

export interface StoredCredential {
  id: string;
  userId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

export async function findCredential(credentialId: string): Promise<StoredCredential | null> {
  const row = await prisma.credential.findUnique({
    where: { id: credentialId },
    select: { id: true, userId: true, publicKey: true, counter: true, transports: true },
  });

  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    // `from` (not `new`) so the buffer type is a plain ArrayBuffer, which is
    // what @simplewebauthn/server's WebAuthnCredential expects.
    publicKey: Uint8Array.from(row.publicKey),
    counter: Number(row.counter),
    transports: row.transports,
  };
}

export async function updateCredentialCounter(id: string, counter: number): Promise<void> {
  await prisma.credential.update({
    where: { id },
    data: { counter: BigInt(counter), lastUsedAt: new Date() },
  });
}
