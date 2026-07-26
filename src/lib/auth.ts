import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { query, queryOne } from './db';

export const SESSION_COOKIE = 'padel_session';
const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Cookies hold a random token; the database only ever stores its hash, so a
 * leaked database dump cannot be turned into a valid session.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);

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

  const row = await queryOne<{ id: string; username: string; display_name: string }>(
    `SELECT u.id, u.username, u.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );

  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }
  store.delete(SESSION_COOKIE);
}

/** Housekeeping for expired sessions and challenges; cheap enough to run on login. */
export async function pruneExpired(): Promise<void> {
  await query('DELETE FROM sessions WHERE expires_at < now()');
  await query('DELETE FROM webauthn_challenges WHERE expires_at < now()');
}
