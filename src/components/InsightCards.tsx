import type { Insight } from '@/lib/insights';

/**
 * Факты о турнире. Список приходит уже отфильтрованным: карточка появляется
 * только там, где данных хватило, поэтому здесь нечего прятать за условиями.
 */
export default function InsightCards({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {insights.map((insight) => (
        <li key={insight.id} className="card p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
            <span aria-hidden="true">{insight.icon} </span>
            {insight.title}
          </p>
          <p className="mt-1 text-sm leading-snug">{insight.text}</p>
        </li>
      ))}
    </ul>
  );
}
