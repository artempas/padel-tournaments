'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { plural } from '@/lib/plural';
import { RATING_TIERS, START_RATING, type RatingPoint } from '@/lib/rating';

/**
 * Прогрессия рейтинга: точка на турнир.
 *
 * Голым SVG и с измеренной шириной — по тем же причинам, что и DynamicsChart:
 * сторонних библиотек в проекте нет, а масштабировать viewBox нельзя, потому
 * что вместе с ним поплыли бы подписи.
 *
 * Точка на турнир, а не на матч, выбрана намеренно: внутри вечера рейтинг
 * пляшет по десятку раз, и на ширине телефона это шум, а не история. Матчи
 * никуда не деваются — они внутри точки, и их показывает список под графиком.
 *
 * Пороги ступеней нарисованы прямо на поле. Без них вертикаль ничего не значит:
 * «вырос на 12» — это много или мало, видно только по тому, пересёк ли рост
 * границу золота.
 */

const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const PAD_LEFT = 30;
const PAD_RIGHT = 10;
const HEIGHT = 160;

/** Запас по вертикали, чтобы линия не липла к краям поля. */
const HEADROOM = 6;

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'short' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

export default function RatingChart({
  history,
  selected,
  onSelect,
  color,
}: {
  history: RatingPoint[];
  /** id выбранного турнира: точка подсвечивается, подпись уезжает под график. */
  selected: string | null;
  onSelect: (tournamentId: string) => void;
  color: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;

    // Ширина берётся сразу, а не с первого срабатывания наблюдателя: тот
    // приходит следующим кадром, и график успел бы мигнуть пустым местом.
    setWidth(element.clientWidth);

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Линия начинается со стартового рейтинга: первый турнир — это сдвиг от
  // него, и без начальной точки он бы не нарисовался.
  const values = useMemo(() => [START_RATING, ...history.map((p) => p.rating)], [history]);

  const { low, high } = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { low: min - HEADROOM, high: max + HEADROOM };
  }, [values]);

  const plotWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const x = (index: number): number =>
    PAD_LEFT + (values.length > 1 ? (index * plotWidth) / (values.length - 1) : plotWidth / 2);
  const y = (rating: number): number =>
    PAD_TOP + ((high - rating) / (high - low)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const selectedIndex = history.findIndex((p) => p.tournamentId === selected);

  // Подписи месяцев: на длинной истории они наезжают друг на друга, поэтому
  // ставятся через одну и не повторяются подряд — «мар, мар» не сообщает ничего.
  const labels = useMemo(() => {
    const every = Math.ceil(history.length / 5);
    const seen: string[] = [];
    return history.map((point, index) => {
      const text = monthFormat.format(new Date(point.at)).replace('.', '');
      if (index % every !== 0 || seen[seen.length - 1] === text) return null;
      seen.push(text);
      return text;
    });
  }, [history]);

  // У нижней ступени порога нет — её границу задаёт следующая, и рисовать
  // тут нечего.
  const floors = RATING_TIERS.flatMap((tier) =>
    tier.floor !== null && tier.floor > low && tier.floor < high
      ? [{ id: tier.id, floor: tier.floor }]
      : [],
  );

  return (
    <div ref={wrap}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Рейтинг по турнирам: от ${values[0]} до ${values[values.length - 1]} за ${history.length} ${plural(history.length, 'турнир', 'турнира', 'турниров')}`}
        >
          {floors.map((tier) => (
            <g key={tier.id}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + plotWidth}
                y1={y(tier.floor)}
                y2={y(tier.floor)}
                stroke={`var(--color-${tier.id})`}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.5}
              />
              <text
                x={PAD_LEFT - 6}
                y={y(tier.floor) + 3}
                textAnchor="end"
                fontSize={9}
                fill={`var(--color-${tier.id})`}
              >
                {tier.floor}
              </text>
            </g>
          ))}

          {labels.map((text, index) =>
            text === null ? null : (
              <text
                key={history[index].tournamentId}
                x={x(index + 1)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-muted)"
              >
                {text}
              </text>
            ),
          )}

          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {history.map((point, index) => (
            <circle
              key={point.tournamentId}
              cx={x(index + 1)}
              cy={y(point.rating)}
              r={point.tournamentId === selected ? 4 : 2}
              fill={point.tournamentId === selected ? color : 'var(--color-ink)'}
              stroke={color}
              strokeWidth={1.5}
            />
          ))}

          {selectedIndex >= 0 && (
            <line
              x1={x(selectedIndex + 1)}
              x2={x(selectedIndex + 1)}
              y1={y(history[selectedIndex].rating)}
              y2={HEIGHT - PAD_BOTTOM}
              stroke={color}
              strokeWidth={1}
              opacity={0.4}
            />
          )}

          {/* Мишени поверх всего: попасть пальцем в точку радиусом 2 нельзя. */}
          {history.map((point, index) => (
            <rect
              key={point.tournamentId}
              x={x(index + 1) - Math.max(8, plotWidth / history.length / 2)}
              y={0}
              width={Math.max(16, plotWidth / history.length)}
              height={HEIGHT}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(point.tournamentId)}
            />
          ))}
        </svg>
      )}

      {/* То же словами: программе чтения экрана ломаная недоступна. Список
          турниров под графиком дублирует и выбор — там он с клавиатуры. */}
      <ul className="sr-only">
        {history.map((point) => (
          <li key={point.tournamentId}>
            {dayFormat.format(new Date(point.at))}: рейтинг {point.rating}, изменение{' '}
            {point.delta > 0 ? `+${point.delta}` : point.delta}
          </li>
        ))}
      </ul>
    </div>
  );
}
