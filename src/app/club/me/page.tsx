import Link from 'next/link';
import { notFound } from 'next/navigation';
import ClubBadge from '@/components/ClubBadge';
import ThemeToggle from '@/components/ThemeToggle';
import { TierIcon, TierSprite } from '@/components/TierIcon';
import LinkedAccountCard from '@/components/LinkedAccountCard';
import SsoButton from '@/components/SsoButton';
import YandexButton from '@/components/YandexButton';
import { pageMembership } from '@/lib/club-page';
import { linkedAccount } from '@/lib/oauth';
import { ssoConfig, ssoNotice } from '@/lib/sso';
import { yandexConfig, yandexNotice } from '@/lib/yandex';
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
export default async function ClubProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ yandex?: string; sso?: string }>;
}) {
  const { club, role, personId, user } = await pageMembership();
  const { yandex, sso } = await searchParams;

  const showYandex = yandexConfig() !== null;
  const ssoName = ssoConfig()?.name;
  const notice = yandexNotice(yandex) ?? ssoNotice(sso, ssoName ?? 'SSO');

  const [stats, linkedYandex, linkedSso] = await Promise.all([
    rosterStats(club.id),
    showYandex ? linkedAccount(user.id, 'yandex') : null,
    ssoName ? linkedAccount(user.id, 'sso') : null,
  ]);
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

      {/* Ниже — про аккаунт, а не про клуб: рейтинг и матчи у человека в каждом
          клубе свои, а вход один на всё приложение. Отдельной страницы под
          единственную настройку не нужно, но заголовок нужен: без него
          «привязать Яндекс» читалось бы как что-то клубное. */}
      {(showYandex || ssoName) && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Аккаунт</h2>
          {notice && (
            <p className="mt-3 rounded-xl border border-line bg-ink px-4 py-3 text-sm text-muted">
              {notice}
            </p>
          )}
          {ssoName && (
            <LinkedAccountCard
              title={`Вход через ${ssoName}`}
              hint={`Привяжите ${ssoName}, чтобы входить им — остальные способы входа останутся.`}
              endpoint="/api/auth/sso"
              linkButton={<SsoButton name={ssoName} next="/club/me" label={`Привязать ${ssoName}`} />}
              linked={linkedSso}
            />
          )}
          {showYandex && (
            <LinkedAccountCard
              title="Вход через Яндекс ID"
              hint="Привяжите Яндекс, чтобы входить им — остальные способы входа останутся."
              endpoint="/api/auth/yandex"
              linkButton={<YandexButton next="/club/me" label="Привязать Яндекс ID" />}
              linked={linkedYandex}
            />
          )}
        </>
      )}
    </main>
  );
}
