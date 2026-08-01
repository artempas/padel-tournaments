import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from './prisma';

export const SESSION_COOKIE = 'padel_session';
// Экспортируется, потому что срок хранения сессии называет ещё и политика
// обработки данных (app/privacy). Два числа на один срок разошлись бы.
export const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
}

/** Хранится и сравнивается как bytea — 32 байта вместо 64 символов hex. */
function hashToken(token: string): Uint8Array<ArrayBuffer> {
  // `from`, а не сам Buffer: Prisma ждёт Uint8Array с обычным ArrayBuffer.
  return Uint8Array.from(createHash('sha256').update(token).digest());
}

/**
 * Cookies hold a random token; the database only ever stores its hash, so a
 * leaked database dump cannot be turned into a valid session.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, username: true, displayName: true } } },
  });

  return session?.user ?? null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    // deleteMany, а не delete: удаление отсутствующей строки не должно падать.
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

/** Housekeeping for expired sessions and challenges; cheap enough to run on login. */
export async function pruneExpired(): Promise<void> {
  const now = new Date();
  await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
