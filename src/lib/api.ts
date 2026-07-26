import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './auth';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Wraps a route handler so thrown `ApiError`s become clean JSON responses. */
export function route<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message }, err.status);
      }
      console.error(err);
      return json({ error: 'Внутренняя ошибка сервера' }, 500);
    }
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError('Требуется вход', 401);
  return user;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError('Некорректный JSON в теле запроса');
  }
}
