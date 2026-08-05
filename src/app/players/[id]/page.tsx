import { notFound } from 'next/navigation';
import PlayerProfileView from '@/components/PlayerProfileView';
import { ApiError } from '@/lib/api';
import { pageMembership } from '@/lib/club-page';
import { playerProfile } from '@/lib/roster';

export const dynamic = 'force-dynamic';

/**
 * Профиль игрока. Клуб берётся выбранный, а не клуб самого игрока: игрок
 * принадлежит клубу по построению, и чужой ссылке здесь взяться неоткуда —
 * `playerProfile` ищет только среди своих и на постороннего отвечает 404.
 */
export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { club } = await pageMembership();
  const { id } = await params;

  try {
    const profile = await playerProfile(club.id, id);
    if (!profile) notFound();

    return <PlayerProfileView profile={profile} clubName={club.name} />;
  } catch (err) {
    // Ссылка с мусором вместо uuid — это то же «не найдено», а не поломка.
    if (err instanceof ApiError) notFound();
    throw err;
  }
}
