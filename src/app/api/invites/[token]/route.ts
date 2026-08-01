import { json, readJson, requireUser, route } from '@/lib/api';
import { setCurrentClub } from '@/lib/club-context';
import { acceptInvite, readInvite, type AcceptChoice } from '@/lib/invites';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

/** Что за клуб зовёт и из кого выбирать себя. */
export const GET = route(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { token } = await context.params;
  return json(await readInvite(token, user.id));
});

/** Вступить: назваться одним из игроков клуба или завести нового. */
export const POST = route(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { token } = await context.params;
  const body = await readJson<AcceptChoice>(request);

  const clubId = await acceptInvite(token, user.id, body);
  // Человек пришёл именно сюда — показывать ему после вступления другой клуб
  // было бы странно.
  await setCurrentClub(clubId);

  return json({ clubId });
});
