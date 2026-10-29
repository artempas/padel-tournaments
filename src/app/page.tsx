import { redirect } from 'next/navigation';
import AuthScreen from '@/components/AuthScreen';
import { getCurrentUser } from '@/lib/auth';
import { ssoConfig, ssoNotice } from '@/lib/sso';
import { yandexConfig, yandexNotice } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ yandex?: string; sso?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/tournaments');

  const { yandex, sso } = await searchParams;
  const ssoName = ssoConfig()?.name;
  return (
    <AuthScreen
      yandex={yandexConfig() !== null}
      sso={ssoName}
      notice={yandexNotice(yandex) ?? ssoNotice(sso, ssoName ?? 'SSO') ?? undefined}
    />
  );
}
