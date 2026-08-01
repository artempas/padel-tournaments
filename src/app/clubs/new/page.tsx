import { redirect } from 'next/navigation';
import NewClubForm from '@/components/NewClubForm';
import { getCurrentUser } from '@/lib/auth';
import { listMyClubs } from '@/lib/club-context';

export const dynamic = 'force-dynamic';

export default async function NewClubPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  // Единственная страница, куда попадают и без клуба: сюда уводит
  // pageMembership(), когда клубов не осталось совсем.
  const clubs = await listMyClubs(user.id);

  return <NewClubForm displayName={user.displayName} first={clubs.length === 0} />;
}
