import Link from 'next/link';
import ClubSwitcher from '@/components/ClubSwitcher';
import LogoutButton from '@/components/LogoutButton';
import ThemeToggle from '@/components/ThemeToggle';
import { listMyClubs } from '@/lib/club-context';
import { pageMembership } from '@/lib/club-page';
import { formatLabel, tournamentSize } from '@/lib/formats';
import { can } from '@/lib/permissions';
import { listRoster } from '@/lib/roster';
import { listTournaments } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

export default async function TournamentsPage() {
  const { club, role, user, personName } = await pageMembership();

  const [tournaments, roster, clubs] = await Promise.all([
    listTournaments(club.id),
    listRoster(club.id),
    listMyClubs(user.id),
  ]);
  const rosterSize = roster.length;
  const mayCreate = can(role, 'tournament:create');

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-6 sm:px-6">
      <header className="mb-6 flex items-center gap-2">
        {/* Клуб задаёт всё, что ниже, поэтому он и стоит первым — это не
            украшение шапки, а то, в каком разрезе смотрят на данные. */}
        <div className="min-w-0 flex-1">
          <ClubSwitcher current={club} clubs={clubs} />
        </div>
        <ThemeToggle />
        <LogoutButton />
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Link
          href="/club/me"
          className="card flex items-center gap-2 p-3 transition active:scale-[0.99]"
        >
          <span className="text-xl">🎾</span>
          <span className="min-w-0">
            {/* Имя игрока в этом клубе, а не аккаунта: в турнирах и таблице
                человек фигурирует именно так. */}
            <span className="block truncate text-sm font-semibold">{personName}</span>
            <span className="block text-xs text-muted">Мой профиль</span>
          </span>
        </Link>
        <Link
          href="/club"
          className="card flex items-center gap-2 p-3 transition active:scale-[0.99]"
        >
          <span className="text-xl">⚙️</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">Клуб</span>
            <span className="block text-xs text-muted">Игроки и участники</span>
          </span>
        </Link>
      </div>

      {rosterSize > 0 && (
        <Link
          href="/players"
          className="card mb-4 flex items-center gap-3 p-4 transition active:scale-[0.99]"
        >
          <span className="text-2xl">👥</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Игроки</span>
            <span className="block text-sm text-muted">
              {rosterSize} сохранено · общий счёт по всем турнирам
            </span>
          </span>
          <span className="shrink-0 text-muted">→</span>
        </Link>
      )}

      {tournaments.length === 0 ? (
        <div className="card px-5 py-12 text-center">
          <div className="mb-3 text-4xl">🎾</div>
          <h2 className="text-lg font-semibold">Пока нет турниров</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
            {mayCreate
              ? 'Заведите список игроков и число кортов — расписание составится само.'
              : 'Турниры заводят администраторы клуба. Как только появится первый, он будет здесь.'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {tournaments.map((t) => {
            // Не matchCount: у мексикано матчи появляются по ходу турнира, и
            // счётчик созданных всё время равнялся бы сыгранным. Но и не меньше
            // него — продлённое американо длиннее, чем «каждый с каждым».
            const total = tournamentSize(
              t.format,
              t.playerCount,
              t.courts,
              t.roundsPlanned,
              t.matchCount,
            ).matches;
            const progress = total ? Math.round((t.playedCount / total) * 100) : 0;
            return (
              <li key={t.id}>
                <Link href={`/tournaments/${t.id}`} className="card block p-4 transition active:scale-[0.99]">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{t.name}</h2>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        t.status === 'finished'
                          ? 'bg-accent text-accent-ink'
                          : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {t.status !== 'finished'
                        ? 'Идёт'
                        : t.playedCount < total
                          ? 'Завершён досрочно'
                          : 'Завершён'}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-muted">
                    {formatLabel(t.format)} · {t.playerCount} игроков · {t.courts}{' '}
                    {t.courts === 1 ? 'корт' : t.courts < 5 ? 'корта' : 'кортов'} ·{' '}
                    {dateFormat.format(new Date(t.createdAt))}
                  </p>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {t.playedCount}/{total}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {mayCreate && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-ink/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-2xl">
            <Link
              href="/tournaments/new"
              className="tap flex items-center justify-center rounded-xl bg-accent px-4 font-bold text-accent-ink"
            >
              Новый турнир
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
