import { json, readJson, route } from '@/lib/api';
import { createSession } from '@/lib/auth';
import { completeSignup } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/**
 * Завершение регистрации через Яндекс: человек назвал себя, и только теперь
 * появляется аккаунт.
 *
 * Кто регистрируется, роут не спрашивает и спросить не может — это лежит в
 * начатой регистрации, а от клиента приходит одно лишь имя.
 */
export const POST = route(async (request: Request) => {
  const body = await readJson<{ name?: unknown }>(request);
  const { userId, next } = await completeSignup(body.name);

  await createSession(userId);

  return json({ next });
});
