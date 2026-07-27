import { plural } from './plural.ts';
import type { Standing } from './types';

/**
 * Картинка с результатами рисуется на canvas прямо в браузере: на корте сети
 * может не быть, а поделиться итогом хочется сразу после последнего матча.
 * Поэтому ни запроса к серверу, ни сторонней библиотеки здесь нет.
 */
export interface ResultsCardData {
  name: string;
  /** Человеческое название формата — «Американо». */
  format: string;
  /** ISO-время: когда турнир завершён, иначе когда создан. */
  date: string;
  finished: boolean;
  playedCount: number;
  totalMatches: number;
  standings: Standing[];
}

/**
 * Заголовок и строка под ним. Отдельно от рисования, потому что тем же текстом
 * подписывается сама отправка: получателю без картинки видна хотя бы суть.
 */
export function resultsSummary(data: ResultsCardData): { headline: string; detail: string } {
  const remaining = Math.max(0, data.totalMatches - data.playedCount);
  const leader = data.standings[0];

  if (data.playedCount === 0 || !leader) {
    return {
      headline: data.finished ? 'Турнир завершён' : 'Турнир идёт',
      detail: 'Ни одного матча не сыграно',
    };
  }

  const points = `${leader.pointsFor} ${plural(leader.pointsFor, 'очко', 'очка', 'очков')}`;

  if (data.finished) {
    // «Досрочно» — ровно как на экране турнира: пока что-то осталось несыгранным.
    return {
      headline: remaining > 0 ? 'Турнир завершён досрочно' : 'Турнир завершён',
      detail:
        `Победитель — ${leader.name}, ${points}` +
        (remaining > 0
          ? `. Не сыграно ${remaining} ${plural(remaining, 'матч', 'матча', 'матчей')}`
          : ''),
    };
  }

  return {
    headline: 'Турнир идёт',
    detail: `Впереди ${leader.name}, ${points}. Сыграно ${data.playedCount} из ${data.totalMatches}`,
  };
}

/** Имя файла — латиницей и с датой: так его проще найти в галерее и в чате. */
export function resultsFileName(data: ResultsCardData): string {
  const day = data.date.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `padel-${day}.png` : 'padel-results.png';
}

// Палитра тёмной темы: картинка уходит в чужой чат, где нет ни наших
// переменных, ни выбранной пользователем темы, поэтому цвета зашиты.
const COLOR = {
  ink: '#070c16',
  surface: '#101a2c',
  line: '#24344f',
  lineSoft: '#24344fb3',
  text: '#e9f0fa',
  muted: '#8ba0c0',
  accent: '#c6f24e',
  accentSoft: '#c6f24e1f',
  accentLine: '#c6f24e80',
};

const FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Логические размеры вёрстки; пиксели картинки — они же, умноженные на SCALE. */
const SCALE = 3;
const WIDTH = 420;
const PAD = 26;
const INNER = WIDTH - PAD * 2;

const TITLE_LINE = 32;
const META_H = 16;
const BANNER_PAD = 16;
const HEADLINE_H = 20;
const DETAIL_LINE = 19;
const TABLE_HEAD_H = 30;
const ROW_H = 34;
const FOOTER_H = 15;
const GAP_TITLE_META = 6;
const GAP_META_BANNER = 20;
const GAP_BANNER_TABLE = 20;
const GAP_TABLE_FOOTER = 16;

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FAMILY}`;
}

/** Строка, укороченная многоточием до ширины колонки. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Перенос по словам; последняя строка, если не влезло, обрезается многоточием. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);

  if (lines.length <= maxLines) return lines;
  // Всё, что не поместилось, сходится в последнюю строку и обрезается там.
  const kept = lines.slice(0, maxLines - 1);
  kept.push(fitText(ctx, lines.slice(maxLines - 1).join(' '), maxWidth));
  return kept;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Картинка с итоговой таблицей. Размер по числу игроков — обрезать некого. */
export function renderResultsCard(data: ResultsCardData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');

  const { headline, detail } = resultsSummary(data);

  // Замер идёт до того, как задан размер холста: смена размера сбрасывает
  // контекст, поэтому число строк известно раньше, чем начинается рисование.
  ctx.font = font(700, 27);
  const titleLines = wrapText(ctx, data.name, INNER, 2);
  ctx.font = font(400, 13.5);
  const detailLines = wrapText(ctx, detail, INNER - BANNER_PAD * 2, 2);

  const titleH = titleLines.length * TITLE_LINE;
  const bannerH = BANNER_PAD * 2 + HEADLINE_H + 4 + detailLines.length * DETAIL_LINE;
  const tableH = TABLE_HEAD_H + data.standings.length * ROW_H;
  const height =
    PAD +
    titleH +
    GAP_TITLE_META +
    META_H +
    GAP_META_BANNER +
    bannerH +
    GAP_BANNER_TABLE +
    tableH +
    GAP_TABLE_FOOTER +
    FOOTER_H +
    PAD;

  canvas.width = WIDTH * SCALE;
  canvas.height = Math.round(height) * SCALE;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = COLOR.ink;
  ctx.fillRect(0, 0, WIDTH, height);

  let y = PAD;

  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.text;
  ctx.font = font(700, 27);
  titleLines.forEach((line, i) => ctx.fillText(line, PAD, y + 22 + i * TITLE_LINE));
  y += titleH + GAP_TITLE_META;

  const date = formatDate(data.date);
  const meta = [
    data.format,
    `${data.playedCount} ${plural(data.playedCount, 'матч', 'матча', 'матчей')}`,
    date,
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.font = font(600, 12.5);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText(fitText(ctx, meta, INNER), PAD, y + 12);
  y += META_H + GAP_META_BANNER;

  roundRect(ctx, PAD, y, INNER, bannerH, 16);
  ctx.fillStyle = COLOR.accentSoft;
  ctx.fill();
  ctx.strokeStyle = COLOR.accentLine;
  ctx.lineWidth = 1;
  ctx.stroke();

  const trophy = data.finished && data.playedCount > 0 ? '🏆 ' : '';
  ctx.font = font(700, 16);
  ctx.fillStyle = COLOR.accent;
  ctx.fillText(`${trophy}${headline}`, PAD + BANNER_PAD, y + BANNER_PAD + 15);
  ctx.font = font(400, 13.5);
  ctx.fillStyle = COLOR.muted;
  detailLines.forEach((line, i) =>
    ctx.fillText(line, PAD + BANNER_PAD, y + BANNER_PAD + HEADLINE_H + 18 + i * DETAIL_LINE),
  );
  y += bannerH + GAP_BANNER_TABLE;

  // Таблица — те же колонки и тот же порядок, что на экране турнира.
  const left = PAD;
  const right = PAD + INNER;
  const rankX = left + 16;
  const nameX = left + 42;
  const diffRight = right - 16;
  const gamesRight = diffRight - 44;
  const pointsRight = gamesRight - 38;
  // Зазор до колонки очков: длинное имя обрывается многоточием, а не упирается
  // в число.
  const nameMax = pointsRight - 44 - nameX;

  roundRect(ctx, left, y, INNER, tableH, 16);
  ctx.fillStyle = COLOR.surface;
  ctx.fill();
  ctx.strokeStyle = COLOR.line;
  ctx.stroke();

  ctx.font = font(600, 11);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText('#', rankX, y + 19);
  ctx.fillText('ИГРОК', nameX, y + 19);
  ctx.textAlign = 'right';
  ctx.fillText('ОЧКИ', pointsRight, y + 19);
  ctx.fillText('ИГР', gamesRight, y + 19);
  ctx.fillText('РАЗН.', diffRight, y + 19);
  ctx.textAlign = 'left';

  ctx.strokeStyle = COLOR.line;
  ctx.beginPath();
  ctx.moveTo(left, y + TABLE_HEAD_H);
  ctx.lineTo(right, y + TABLE_HEAD_H);
  ctx.stroke();

  data.standings.forEach((row, i) => {
    const top = y + TABLE_HEAD_H + i * ROW_H;
    const base = top + ROW_H / 2 + 5;
    const isWinner = i === 0 && data.playedCount > 0;

    if (isWinner) {
      ctx.fillStyle = COLOR.accentSoft;
      ctx.fillRect(left + 1, top, INNER - 2, ROW_H);
    } else if (i > 0) {
      ctx.strokeStyle = COLOR.lineSoft;
      ctx.beginPath();
      ctx.moveTo(left + 12, top);
      ctx.lineTo(right - 12, top);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.font = font(700, 13);
    ctx.fillStyle = isWinner ? COLOR.accent : COLOR.muted;
    ctx.fillText(String(i + 1), rankX, base);

    ctx.font = font(isWinner ? 700 : 500, 14.5);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(fitText(ctx, row.name, nameMax), nameX, base);

    ctx.textAlign = 'right';
    ctx.font = font(700, 15.5);
    ctx.fillText(String(row.pointsFor), pointsRight, base);
    ctx.font = font(400, 13);
    ctx.fillStyle = COLOR.muted;
    ctx.fillText(String(row.played), gamesRight, base);
    ctx.fillText(row.diff > 0 ? `+${row.diff}` : String(row.diff), diffRight, base);
  });

  y += tableH + GAP_TABLE_FOOTER;

  ctx.textAlign = 'left';
  ctx.font = font(500, 11.5);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText('Падел Турниры', PAD, y + 11);

  return canvas;
}

/** Готовый файл: им и делятся, и его же показывают в предпросмотре. */
export async function resultsCardFile(data: ResultsCardData): Promise<File> {
  const canvas = renderResultsCard(data);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Не удалось собрать картинку');
  return new File([blob], resultsFileName(data), { type: 'image/png' });
}
