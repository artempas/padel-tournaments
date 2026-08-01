import { json, readJson, route } from '@/lib/api';
import { requireMembershipForTournament } from '@/lib/club-context';
import { setMatchScore } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; matchId: string }> };

interface Body {
  score1: number | null;
  score2: number | null;
}

export const PATCH = route(async (request: Request, context: Context) => {
  const { id, matchId } = await context.params;
  const { club, role, personId } = await requireMembershipForTournament(id);
  const body = await readJson<Body>(request);

  // Кто именно вправе трогать этот матч, решает setMatchScore: участнику
  // нужно стоять в четвёрке, и проверяется это по составу, а не по словам
  // клиента.
  const tournament = await setMatchScore(
    id,
    matchId,
    { clubId: club.id, role, personId },
    body.score1 ?? null,
    body.score2 ?? null,
  );

  return json({ tournament });
});
