'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { positionsById, type RoundSnapshot } from '@/lib/insights';
import { plural } from '@/lib/plural';

/**
 * Места игроков по раундам — линия на каждого.
 *
 * Рисуется голым SVG: сторонних библиотек в проекте нет, а всё, что нужно
 * такому графику, — это ломаные и подписи. Ширина измеряется, а не задаётся
 * viewBox'ом с масштабированием: иначе на телефоне подписи были бы мельче
 * читаемого, а на широком экране разъезжались бы в заголовки.
 */

const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const PAD_LEFT = 26;
const NAME_WIDTH = 92;
const ROW = 24;

/** Цвета призёров; остальные линии — приглушённые, чтобы не мешать читать. */
const MEDALS = ['var(--color-accent)', 'var(--color-court)', 'var(--color-warn)'];
const PLAIN = 'var(--color-muted)';
/** Выбранный игрок вне тройки: цвета призёра ему не положено, заметность — да. */
const PICKED = 'var(--color-text)';

function shortName(name: string): string {
  return name.length > 11 ? `${name.slice(0, 10)}…` : name;
}

export default function DynamicsChart({ history }: { history: RoundSnapshot[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tracks = useMemo(() => {
    const positions = positionsById(history);
    const final = history[history.length - 1].standings;
    return final.map((row, index) => ({
      id: row.playerId,
      name: row.name,
      positions: positions.get(row.playerId) ?? [],
      color: index < MEDALS.length ? MEDALS[index] : PLAIN,
      medal: index < MEDALS.length,
    }));
  }, [history]);

  const rounds = history.map((snapshot) => snapshot.round);
  const height = PAD_TOP + (tracks.length - 1) * ROW + PAD_BOTTOM;
  const plotWidth = Math.max(0, width - PAD_LEFT - NAME_WIDTH);
  const x = (index: number): number =>
    PAD_LEFT + (rounds.length > 1 ? (index * plotWidth) / (rounds.length - 1) : plotWidth / 2);
  const y = (position: number): number => PAD_TOP + (position - 1) * ROW;
  // На длинном турнире подписи раундов начинают наезжать друг на друга.
  const labelEvery = rounds.length > 10 ? 2 : 1;

  return (
    <div ref={wrap}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Места по раундам: ${rounds.length} ${plural(rounds.length, 'раунд', 'раунда', 'раундов')}, ${tracks.length} ${plural(tracks.length, 'игрок', 'игрока', 'игроков')}`}
        >
          {tracks.map((_, index) => (
            <line
              key={index}
              x1={PAD_LEFT}
              x2={PAD_LEFT + plotWidth}
              y1={y(index + 1)}
              y2={y(index + 1)}
              stroke="var(--color-line)"
              strokeWidth={1}
              opacity={0.5}
            />
          ))}

          {tracks.map((_, index) => (
            <text
              key={index}
              x={PAD_LEFT - 8}
              y={y(index + 1) + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-muted)"
            >
              {index + 1}
            </text>
          ))}

          {rounds.map((round, index) =>
            index % labelEvery === 0 || index === rounds.length - 1 ? (
              <text
                key={round}
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-muted)"
              >
                {round}
              </text>
            ) : null,
          )}

          {/* Подсвеченные линии рисуются последними — поверх остальных. */}
          {[...tracks]
            .sort((a, b) => Number(a.medal) - Number(b.medal))
            .sort((a, b) => Number(a.id === selected) - Number(b.id === selected))
            .map((track) => {
              const active = selected === null ? track.medal : track.id === selected;
              const color = track.medal ? track.color : PICKED;
              const line = track.positions.map((p, i) => `${x(i)},${y(p)}`).join(' ');

              return (
                <g
                  key={track.id}
                  onClick={() => setSelected(selected === track.id ? null : track.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Широкая невидимая ломаная — попасть пальцем по линии. */}
                  <polyline
                    points={line}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    pointerEvents="stroke"
                  />
                  <polyline
                    points={line}
                    fill="none"
                    stroke={active ? color : PLAIN}
                    strokeWidth={active ? 2.5 : 1}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={active ? 1 : 0.35}
                  />
                  {active &&
                    track.positions.map((position, index) => (
                      <circle
                        key={index}
                        cx={x(index)}
                        cy={y(position)}
                        r={2.5}
                        fill={color}
                      />
                    ))}
                  <text
                    x={PAD_LEFT + plotWidth + 8}
                    y={y(track.positions[track.positions.length - 1]) + 4}
                    fontSize={11}
                    fontWeight={active ? 700 : 400}
                    fill={active ? color : PLAIN}
                    opacity={active ? 1 : 0.7}
                  >
                    {shortName(track.name)}
                  </text>
                </g>
              );
            })}
        </svg>
      )}

      {/* То же самое словами: график мышью не читается программой чтения. */}
      <ul className="sr-only">
        {tracks.map((track) => (
          <li key={track.id}>
            {track.name}: места по раундам — {track.positions.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
