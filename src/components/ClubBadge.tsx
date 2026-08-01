import { CLUB_BACKGROUND } from '@/lib/club-style';

/** Значок клуба: эмодзи на цветной плашке. */

export default function ClubBadge({
  icon,
  color,
  size = 'md',
}: {
  icon: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'sm' ? 'h-7 w-7 text-base' : size === 'lg' ? 'h-16 w-16 text-3xl' : 'h-9 w-9 text-lg';

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl ${box} ${
        CLUB_BACKGROUND[color] ?? CLUB_BACKGROUND.lime
      }`}
    >
      {icon}
    </span>
  );
}
