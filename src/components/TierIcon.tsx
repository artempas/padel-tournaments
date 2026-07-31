import type { TierId } from '@/lib/rating';

/**
 * Значки ступеней.
 *
 * Живут спрайтом, а не пятью отдельными файлами в `public`, по двум причинам.
 * Во-первых, приложение работает без сети, и всё, что грузится отдельным
 * запросом, пришлось бы отдельно же класть в кэш service worker. Во-вторых, в
 * исходных SVG градиенты назывались одинаково (`ringGrad`, `bgGrad`,
 * `gemGrad`); на одной странице такие id сталкиваются, и все значки
 * покрасились бы первым попавшимся. Здесь они разведены по ступеням.
 *
 * `<symbol>` объявляется один раз на экран, строки таблицы ссылаются на него
 * через `<use>` — иначе десять значков принесли бы в DOM десять копий
 * градиентов с повторяющимися id.
 */

interface Palette {
  id: Exclude<TierId, 'calibration'>;
  /** Кайма шестиугольника: светлый → основной → тёмный. */
  ring: [string, string, string];
  ringStroke: string;
  /** Подложка внутри каймы. */
  bg: [string, string];
  /** Затемнение в центре подложки. */
  inner: string;
  innerOpacity: number;
  /** Сам камень. */
  gem: string[];
  gemStroke: string;
  /** Блик в левом верхнем углу камня. */
  glint: string;
  glintOpacity: number;
  /** Грани камня: [x1, y1, x2, y2, прозрачность]. */
  facets: Array<[number, number, number, number, number]>;
  facetColor: string;
  /** Искры вокруг камня — путь и прозрачность. */
  sparkles: Array<[string, number]>;
}

const PALETTES: Palette[] = [
  {
    id: 'bronze',
    ring: ['#C98A4B', '#9C5F26', '#6B3E17'],
    ringStroke: '#4A2A0E',
    bg: ['#4A2E14', '#2A190B'],
    inner: '#3A230F',
    innerOpacity: 0.55,
    gem: ['#D08A45', '#8B4A1F'],
    gemStroke: '#5C3312',
    glint: '#F0B876',
    glintOpacity: 0.22,
    facets: [],
    facetColor: '#FFFFFF',
    sparkles: [],
  },
  {
    id: 'silver',
    ring: ['#F0F0F0', '#C3C7CC', '#8E949B'],
    ringStroke: '#6B7076',
    bg: ['#5A6068', '#33383D'],
    inner: '#40454B',
    innerOpacity: 0.55,
    gem: ['#E4E7EA', '#A2A9B0'],
    gemStroke: '#6E747A',
    glint: '#FFFFFF',
    glintOpacity: 0.4,
    facets: [[55, 90, 145, 90, 0.5]],
    facetColor: '#FFFFFF',
    sparkles: [],
  },
  {
    id: 'gold',
    ring: ['#FFE998', '#F0BC3E', '#C4900F'],
    ringStroke: '#8A6608',
    bg: ['#6B4E0A', '#3E2C05'],
    inner: '#4A3407',
    innerOpacity: 0.55,
    gem: ['#FFE27A', '#E0A828'],
    gemStroke: '#8A6608',
    glint: '#FFFCEA',
    glintOpacity: 0.55,
    facets: [
      [55, 90, 145, 90, 0.55],
      [75, 65, 100, 150, 0.5],
      [125, 65, 100, 150, 0.5],
    ],
    facetColor: '#FFF6D9',
    sparkles: [],
  },
  {
    id: 'platinum',
    ring: ['#EAFBFB', '#A9DEDE', '#5FA3A3'],
    ringStroke: '#3E7A7A',
    bg: ['#2A4A4A', '#152A2A'],
    inner: '#1E3A3A',
    innerOpacity: 0.55,
    gem: ['#D3F5F5', '#7FCACA'],
    gemStroke: '#3E7A7A',
    glint: '#FFFFFF',
    glintOpacity: 0.6,
    facets: [
      [55, 90, 145, 90, 0.6],
      [75, 65, 100, 150, 0.55],
      [125, 65, 100, 150, 0.55],
      [75, 65, 145, 90, 0.45],
    ],
    facetColor: '#FFFFFF',
    sparkles: [['M 150,45 L152,52 L159,54 L152,56 L150,63 L148,56 L141,54 L148,52 Z', 0.85]],
  },
  {
    id: 'diamond',
    ring: ['#F0FAFF', '#A9D6F5', '#5B8FD6'],
    ringStroke: '#3E6BB0',
    bg: ['#1A2A4A', '#0D1830'],
    inner: '#101F3D',
    innerOpacity: 0.6,
    gem: ['#EAF8FF', '#BFE8FF', '#6FADEE'],
    gemStroke: '#3E6BB0',
    glint: '#FFFFFF',
    glintOpacity: 0.7,
    facets: [
      [55, 90, 145, 90, 0.65],
      [75, 65, 100, 150, 0.6],
      [125, 65, 100, 150, 0.6],
      [75, 65, 145, 90, 0.5],
      [125, 65, 55, 90, 0.5],
    ],
    facetColor: '#FFFFFF',
    sparkles: [
      ['M 148,42 L150.5,49 L157.5,51 L150.5,53 L148,60 L145.5,53 L138.5,51 L145.5,49 Z', 0.9],
      ['M 48,110 L50,115 L55,117 L50,119 L48,124 L46,119 L41,117 L46,115 Z', 0.85],
      [
        'M 140,150 L141.5,154 L145.5,155.5 L141.5,157 L140,161 L138.5,157 L134.5,155.5 L138.5,154 Z',
        0.8,
      ],
    ],
  },
];

/** Кайма шестиугольника. Одна геометрия на все ступени — меняется только цвет. */
const HEX_OUTER = '100,15 173.6,57.5 173.6,142.5 100,185 26.4,142.5 26.4,57.5';
const HEX_BG = '100,28 162.35,64 162.35,136 100,172 37.65,136 37.65,64';
const HEX_INNER = '100,38 153.7,69 153.7,131 100,162 46.3,131 46.3,69';
const GEM = 'M75,65 L125,65 L145,90 L100,150 L55,90 Z';
const GLINT = '80,71 100,71 90,93';

/**
 * Определения значков. Ставится один раз на экран; сам ничего не рисует.
 */
export function TierSprite() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <defs>
        {PALETTES.map((p) => (
          <g key={p.id}>
            <linearGradient id={`tier-${p.id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={p.ring[0]} />
              <stop offset={p.id === 'diamond' ? '45%' : '55%'} stopColor={p.ring[1]} />
              <stop offset="100%" stopColor={p.ring[2]} />
            </linearGradient>
            <linearGradient id={`tier-${p.id}-bg`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={p.bg[0]} />
              <stop offset="100%" stopColor={p.bg[1]} />
            </linearGradient>
            <linearGradient id={`tier-${p.id}-gem`} x1="0%" y1="0%" x2="100%" y2="100%">
              {p.gem.map((color, i) => (
                <stop
                  key={color}
                  offset={`${Math.round((i / (p.gem.length - 1)) * 100)}%`}
                  stopColor={color}
                />
              ))}
            </linearGradient>
          </g>
        ))}
      </defs>

      {PALETTES.map((p) => (
        <symbol key={p.id} id={`tier-${p.id}`} viewBox="0 0 200 200">
          <polygon
            points={HEX_OUTER}
            fill={`url(#tier-${p.id}-ring)`}
            stroke={p.ringStroke}
            strokeWidth="2.5"
          />
          <polygon points={HEX_BG} fill={`url(#tier-${p.id}-bg)`} />
          <polygon points={HEX_INNER} fill={p.inner} opacity={p.innerOpacity} />
          <path
            d={GEM}
            fill={`url(#tier-${p.id}-gem)`}
            stroke={p.gemStroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {p.facets.map(([x1, y1, x2, y2, opacity]) => (
            <line
              key={`${x1},${y1},${x2},${y2}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={p.facetColor}
              strokeWidth="1.5"
              opacity={opacity}
            />
          ))}
          <polygon points={GLINT} fill={p.glint} opacity={p.glintOpacity} />
          {p.sparkles.map(([d, opacity]) => (
            <path key={d} d={d} fill="#FFFFFF" opacity={opacity} />
          ))}
        </symbol>
      ))}
    </svg>
  );
}

/**
 * Значок ступени. У калибровки его нет — вместо камня вопросительный знак:
 * ступень ещё не определилась, и рисовать вместо неё нечего.
 */
export function TierIcon({ id, className = 'h-4 w-4' }: { id: TierId; className?: string }) {
  if (id === 'calibration') {
    return (
      <span aria-hidden="true" className="font-bold">
        ?
      </span>
    );
  }

  return (
    <svg aria-hidden="true" focusable="false" className={`${className} shrink-0`}>
      <use href={`#tier-${id}`} />
    </svg>
  );
}
