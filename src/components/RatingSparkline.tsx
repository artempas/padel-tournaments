/**
 * Линия рейтинга в строке списка — форма без подписей.
 *
 * Отвечает на «растёт или падает», а не «на сколько»: число рядом уже стоит.
 * Поэтому ни осей, ни сетки, ни делений — они на такой высоте всё равно
 * нечитаемы, а форму кривой заслоняют.
 *
 * viewBox с `preserveAspectRatio="none"`: график тянется на всю доступную
 * ширину, а толщина линии от растяжения не зависит — за это отвечает
 * `vector-effect`. Мерить ширину, как в DynamicsChart, здесь не нужно: там
 * растянуть нельзя из-за подписей, а тут их нет.
 */

const W = 100;
const H = 28;

export default function RatingSparkline({
  values,
  color = 'var(--color-accent)',
  className = '',
}: {
  values: number[];
  /** Обычно цвет ступени: линия тогда читается заодно и как «кто это». */
  color?: string;
  className?: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Ровная линия (все турниры с одинаковым рейтингом) не делится на ноль и
  // рисуется посередине, а не по верхнему краю.
  const span = max - min || 1;
  const flat = max === min;

  const point = (value: number, index: number): string => {
    const x = (index * W) / (values.length - 1);
    const y = flat ? H / 2 : H - ((value - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const line = values.map(point).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
