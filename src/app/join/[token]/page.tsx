import Link from 'next/link';
import AuthScreen from '@/components/AuthScreen';
import JoinClubView from '@/components/JoinClubView';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { readInvite } from '@/lib/invites';
import { ssoConfig, ssoNotice } from '@/lib/sso';
import { yandexConfig, yandexNotice } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ yandex?: string; sso?: string }>;
}) {
  const { token } = await params;
  const user = await getCurrentUser();

  // Незнакомому человеку сначала нужен аккаунт: клуб связывает игрока именно
  // с ним. После входа его вернёт сюда же, и приглашение доиграется.
  if (!user) {
    const { yandex, sso } = await searchParams;
    const ssoName = ssoConfig()?.name;
    return (
      <AuthScreen
        next={`/join/${encodeURIComponent(token)}`}
        intro="Вас пригласили в клуб. Войдите или создайте аккаунт — и выберете, кто вы среди игроков."
        yandex={yandexConfig() !== null}
        sso={ssoName}
        notice={yandexNotice(yandex) ?? ssoNotice(sso, ssoName ?? 'SSO') ?? undefined}
      />
    );
  }

  try {
    const preview = await readInvite(token, user.id);
    return <JoinClubView token={token} preview={preview} />;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;

    // Протухшая или отозванная ссылка — обычное дело: у них семь дней жизни, и
    // выпуск новой гасит прежнюю. Это не ошибка приложения, и текст нужен
    // человеческий, а не страница «не найдено».
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5 py-10 text-center">
        <div className="text-5xl">🔗</div>
        <div>
          <h1 className="text-xl font-bold">Ссылка не работает</h1>
          <p className="mt-2 text-sm text-muted">
            {err.message} Попросите у клуба новую — старая могла истечь или её заменили.
          </p>
        </div>
        <Link
          href="/tournaments"
          className="tap flex items-center justify-center rounded-xl bg-accent px-4 font-bold text-accent-ink"
        >
          К своим турнирам
        </Link>
      </main>
    );
  }
}
