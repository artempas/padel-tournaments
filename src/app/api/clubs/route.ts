import { json, readJson, requireUser, route } from '@/lib/api';
import { listMyClubs, setCurrentClub } from '@/lib/club-context';
import { createClub, type CreateClubInput } from '@/lib/clubs';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await requireUser();
  return json({ clubs: await listMyClubs(user.id) });
});

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = await readJson<CreateClubInput>(request);

  const id = await createClub(user.id, body);
  // Только что созданный клуб и есть тот, в котором человек хочет работать —
  // заставлять его выбирать себя же в селекторе незачем.
  await setCurrentClub(id);

  return json({ id }, 201);
});
