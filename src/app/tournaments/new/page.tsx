import { redirect } from 'next/navigation';
import NewTournamentForm from '@/components/NewTournamentForm';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NewTournamentPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');
  return <NewTournamentForm />;
}
