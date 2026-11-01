import type { Match, Player } from '@/lib/types';

/** Only the current unplayed matches use this view; the card owns the score action. */
export default function CourtDiagram({ match, playersById }: {
  match: Match;
  playersById: Map<string, Player>;
}) {
  return (
    <div className="relative isolate min-h-52 overflow-hidden rounded-xl border border-court/50 bg-court/15" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full text-court" viewBox="0 0 320 208" preserveAspectRatio="none" fill="none">
        <rect x="10" y="10" width="300" height="188" rx="2" stroke="currentColor" strokeWidth="1.5" opacity=".65" />
        <path d="M85 10V198M235 10V198M85 104H235" stroke="currentColor" opacity=".4" />
        <path d="M160 5V203" stroke="currentColor" strokeWidth="3" strokeDasharray="3 3" opacity=".9" />
      </svg>
      <div className="relative grid min-h-52 grid-cols-2 gap-6 px-4 py-6">
        {[match.team1, match.team2].map((team, side) => (
          <div key={side} className="flex min-w-0 flex-col justify-evenly gap-5">
            {team.map((id) => (
              <div key={id} className="flex min-w-0 flex-col items-center gap-1.5">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink/70 text-xs font-bold shadow-sm ${side === 0 ? 'bg-accent text-accent-ink' : 'bg-text text-ink'}`}>
                  {(playersById.get(id)?.name ?? '?').slice(0, 1).toLocaleUpperCase('ru')}
                </span>
                <span className="max-w-full break-words rounded-md bg-ink/90 px-2 py-1 text-center text-xs font-semibold leading-snug text-text">
                  {playersById.get(id)?.name ?? '—'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
