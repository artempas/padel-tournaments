import { redirect } from 'next/navigation';
import AuthScreen from '@/components/AuthScreen';
import { getCurrentUser } from '@/lib/auth';
import { yandexConfig, yandexNotice } from '@/lib/yandex';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ yandex?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/tournaments');

  const { yandex } = await searchParams;
  return <AuthScreen yandex={yandexConfig() !== null} notice={yandexNotice(yandex) ?? undefined} />;
}
