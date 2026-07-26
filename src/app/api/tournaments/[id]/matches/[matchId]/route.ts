import { json, readJson, requireUser, route } from '@/lib/api';
import { setMatchScore } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; matchId: string }> };

interface Body {
  score1: number | null;
  score2: number | null;
}

export const PATCH = route(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { id, matchId } = await context.params;
  const body = await readJson<Body>(request);

  const tournament = await setMatchScore(
    id,
    matchId,
    user.id,
    body.score1 ?? null,
    body.score2 ?? null,
  );

  return json({ tournament });
});
