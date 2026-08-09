import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembershipForTournament } from '@/lib/club-context';
import { setMatchScore, setMatchSkipped } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; matchId: string }> };

interface Body {
  score1?: number | null;
  score2?: number | null;
  /** Отложить матч на потом — или вернуть отложенный обратно. */
  skipped?: unknown;
}

export const PATCH = route(async (request: Request, context: Context) => {
  const { id, matchId } = await context.params;
  const { club, role, personId } = await requireMembershipForTournament(id);
  const body = await readJson<Body>(request);
  const actor = { clubId: club.id, role, personId };

  // Две правки одной строки — счёт и отметка «пропущен» — разведены по полю, а
  // не по разным роутам: ресурс тот же самый, и клиент шлёт по одной правке за
  // раз. Права у них при этом разные, и решают это setMatchScore/setMatchSkipped.
  if (body.skipped !== undefined) {
    if (typeof body.skipped !== 'boolean') {
      throw new ApiError('Поле skipped должно быть true или false');
    }
    return json({ tournament: await setMatchSkipped(id, matchId, actor, body.skipped) });
  }

  // Кто именно вправе трогать этот матч, решает setMatchScore: участнику
  // нужно стоять в четвёрке, и проверяется это по составу, а не по словам
  // клиента.
  const tournament = await setMatchScore(
    id,
    matchId,
    actor,
    body.score1 ?? null,
    body.score2 ?? null,
  );

  return json({ tournament });
});
