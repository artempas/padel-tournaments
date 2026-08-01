import { ApiError, json, readJson, route } from '@/lib/api';
import { requireMembershipForTournament } from '@/lib/club-context';
import { can } from '@/lib/permissions';
import { deleteTournament, loadTournament, setTournamentClosed } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club } = await requireMembershipForTournament(id);
  return json({ tournament: await loadTournament(id, club.id) });
});

/** Finish a tournament early, or resume one that was finished early. */
export const PATCH = route(async (request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role } = await requireMembershipForTournament(id);

  if (!can(role, 'tournament:close')) {
    throw new ApiError('Завершать турнир могут администраторы клуба', 403);
  }

  const body = await readJson<{ closedEarly?: unknown }>(request);
  if (typeof body.closedEarly !== 'boolean') {
    throw new ApiError('Поле closedEarly должно быть true или false');
  }

  return json({ tournament: await setTournamentClosed(id, club.id, body.closedEarly) });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const { club, role } = await requireMembershipForTournament(id);

  // Досрочное завершение обратимо, удаление — нет: оно уносит историю всех
  // участников турнира, и это решение владельца клуба.
  if (!can(role, 'tournament:delete')) {
    throw new ApiError('Удалять турниры может только владелец клуба', 403);
  }

  await deleteTournament(id, club.id);
  return json({ ok: true });
});
