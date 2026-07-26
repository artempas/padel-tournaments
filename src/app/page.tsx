import { redirect } from 'next/navigation';
import AuthScreen from '@/components/AuthScreen';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect('/tournaments');
  return <AuthScreen />;
}
