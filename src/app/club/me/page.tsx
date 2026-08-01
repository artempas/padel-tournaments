import Link from 'next/link';
import { notFound } from 'next/navigation';
import ClubBadge from '@/components/ClubBadge';
import ThemeToggle from '@/components/ThemeToggle';
import { TierIcon, TierSprite } from '@/components/TierIcon';
import { pageMembership } from '@/lib/club-page';
import { ROLE_LABELS } from '@/lib/permissions';
import { plural } from '@/lib/plural';
import { CALIBRATION_MATCHES, tierOf } from '@/lib/rating';
import { rosterStats } from '@/lib/roster';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Мой профиль в клубе.
 *
 * Пустого состояния здесь нет и быть не может: участник клуба — это всегда
 * игрок клуба, за этим следит триггер в базе. Поэтому строка в ростере
 * находится всегда, и ветки «свяжитесь с игроком» на экране не нужно.
 */
export default async function ClubProfilePage() {
  const { club, role, personId } = await pageMembership();

  const stats = await rosterStats(club.id);
  const me = stats.find((p) => p.id === personId);
  // Единственный способ сюда попасть — заархивированный игрок, а участника
  // клуба архивировать нельзя. Значит, состояние сломано, и 404 честнее пустой
  // страницы с нулями.
  if (!me) notFound();

  const tier = tierOf(me.rating, me.matches);
  const place = stats.findIndex((p) => p.id === personId) + 1;

  const cells: Array<[string, string]> = [
    ['Рейтинг', String(me.rating)],
    ['Матчей', String(me.matches)],
    ['Побед', me.matches ? `${me.wins} (${Math.round((me.wins / me.matches) * 100)}%)` : '—'],
    ['Турниров', String(me.tournaments)],
    ['Очки', String(me.pointsFor)],
    ['Разница', me.diff > 0 ? `+${me.diff}` : String(me.diff)],
    ['В среднем', me.matches ? (me.pointsFor / me.matches).toFixed(1) : '—'],
    ['Место по очкам', me.matches ? `${place} из ${stats.length}` : '—'],
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
      <TierSprite />
      <header className="mb-5 flex items-center gap-3">
        <Link
          href="/tournaments"
          className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted"
          aria-label="К списку турниров"
        >
          ←
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Мой профиль</h1>
        <ThemeToggle />
      </header>

      <div className="card mb-4 flex items-center gap-4 p-4">
        <ClubBadge icon={club.icon} color={club.color} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{me.name}</p>
          <p className="truncate text-sm text-muted">
            {club.name} · {ROLE_LABELS[role]}
          </p>
        </div>
      </div>

      <div className="card mb-4 flex items-center gap-3 p-4">
        <TierIcon id={tier.id} className="h-10 w-10" />
        <div className="min-w-0">
          <p className="font-semibold">{tier.label}</p>
          <p className="text-sm text-muted">
            {tier.id === 'calibration'
              ? `Ещё ${CALIBRATION_MATCHES - me.matches} ${plural(
                  CALIBRATION_MATCHES - me.matches,
                  'матч',
                  'матча',
                  'матчей',
                )} — и ступень определится`
              : `Рейтинг ${me.rating} в клубе «${club.name}»`}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label} className="card px-3 py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {me.lastPlayedAt && (
        <p className="mt-4 text-sm text-muted">
          Последний матч — {dateFormat.format(new Date(me.lastPlayedAt))}
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Всё это считается по турнирам клуба «{club.name}». В другом клубе у вас свой игрок и свой
        рейтинг: сравнивать между собой компании, которые никогда не играли друг с другом, нечем.
      </p>

      <Link
        href="/players"
        className="card mt-4 flex items-center gap-3 p-4 transition active:scale-[0.99]"
      >
        <span className="text-2xl">👥</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Все игроки клуба</span>
          <span className="block text-sm text-muted">Рейтинг и общий счёт по всем турнирам</span>
        </span>
        <span className="shrink-0 text-muted">→</span>
      </Link>
    </main>
  );
}
