import { redirect } from 'next/navigation';
import AuthScreen from '@/components/AuthScreen';
import { getCurrentUser } from '@/lib/auth';
import { ssoConfig, ssoNotice } from '@/lib/sso';
import { safeNext, yandexConfig, yandexNotice } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ yandex?: string; sso?: string; next?: string }>;
}) {
  const { yandex, sso, next: rawNext } = await searchParams;
  // Куда человек шёл, когда вход сорвался (см. noticePath в lib/yandex.ts):
  // следующая попытка доведёт его туда же.
  const next = safeNext(rawNext);

  const user = await getCurrentUser();
  if (user) redirect(next);

  const ssoName = ssoConfig()?.name;
  return (
    <AuthScreen
      next={next}
      yandex={yandexConfig() !== null}
      sso={ssoName}
      notice={yandexNotice(yandex) ?? ssoNotice(sso, ssoName ?? 'SSO') ?? undefined}
    />
  );
}
