import type { TournamentDetail } from './types.ts';

/**
 * Рассылка изменений открытым экранам: один процесс, подписчики в памяти.
 *
 * Счёт вносит тот, кто на корте, а смотрят на него со всех остальных кортов
 * сразу — поэтому запись должна доехать до чужих телефонов сама. Хаб знает про
 * это ровно две вещи: тему и кадр. Кто читает тему и откуда взялся кадр, его не
 * касается — за счётом сюда приходит `publishTournament`, за доставкой роут
 * `/api/tournaments/[id]/live`.
 *
 * Подписчик не держит соединения с базой: пул настроен на десять (`prisma.ts`),
 * а телефонов на турнире бывает больше. Всё, что стоит подписка, — запись в
 * `Set`.
 */

/** Кадр на проводе: имя события и уже сериализованный JSON. */
export interface LiveFrame {
  event: string;
  data: string;
}

export type LiveListener = (frame: LiveFrame) => void;

declare global {
  var __padelLiveHub: Map<string, Set<LiveListener>> | undefined;
}

/**
 * Хаб живёт на `globalThis` по той же причине, что и клиент Prisma, но причина
 * тут даже жёстче. Next собирает граф route-хендлеров и граф серверных
 * компонентов в разные бандлы, так что `tournaments.ts` может оказаться в
 * процессе двумя экземплярами: публикатор писал бы в одну `Map`, подписчик
 * читал бы другую, и рассылка молча делала бы ничего. Плюс `next dev`
 * переоценивает модули на каждую правку — модульная переменная осиротила бы
 * всех живых подписчиков.
 *
 * Ленивый `Proxy`, как у Prisma, здесь не нужен: пустая `Map` при импорте
 * ничего не стоит и базы не требует.
 */
function hub(): Map<string, Set<LiveListener>> {
  if (!globalThis.__padelLiveHub) globalThis.__padelLiveHub = new Map();
  return globalThis.__padelLiveHub;
}

/** Тема турнира — единственный ключ хаба: снимок не зависит от смотрящего. */
export function tournamentTopic(tournamentId: string): string {
  return `tournament:${tournamentId}`;
}

/**
 * Подписаться на тему. Возвращённую отписку можно звать сколько угодно раз:
 * стрим вызывает её и по обрыву соединения, и по отмене чтения, а какой из
 * путей сработает первым — заранее неизвестно.
 */
export function subscribe(topic: string, listener: LiveListener): () => void {
  const listeners = hub().get(topic) ?? new Set<LiveListener>();
  hub().set(topic, listeners);
  listeners.add(listener);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    // Пустую тему убираем из карты: иначе в контейнере, который живёт
    // неделями, остаётся по пустому `Set` на каждый когда-либо открытый турнир.
    if (listeners.size === 0) hub().delete(topic);
  };
}

/**
 * Разослать кадр подписчикам темы — синхронно и молча.
 *
 * Эта функция работает внутри пути записи счёта, поэтому уронить его она права
 * не имеет. `controller.enqueue` на закрытом стриме бросает `TypeError`, и это
 * нормальное течение дел: подписчик, который бросил, — уже мёртвое соединение,
 * он уходит, остальные получают свой кадр.
 */
export function publish(topic: string, frame: LiveFrame): void {
  const listeners = hub().get(topic);
  if (!listeners) return;

  // Перебор по копии: слушатель вправе отписаться прямо во время доставки —
  // именно так и делает закрывшийся стрим.
  for (const listener of [...listeners]) {
    try {
      listener(frame);
    } catch {
      listeners.delete(listener);
    }
  }

  if (listeners.size === 0) hub().delete(topic);
}

/**
 * Снимок турнира всем, кто держит его экран открытым.
 *
 * Сериализация одна на публикацию, а не на подписчика: двадцать телефонов
 * получают одну и ту же строку. А когда слушать некому — обычный случай, счёт
 * вносят и в одиночку, — не делается и она.
 */
export function publishTournament(tournament: TournamentDetail): void {
  const topic = tournamentTopic(tournament.id);
  if (!hasTopic(topic)) return;
  publish(topic, { event: 'tournament', data: JSON.stringify(tournament) });
}

export function subscriberCount(topic: string): number {
  return hub().get(topic)?.size ?? 0;
}

/** Есть ли тема в хабе вообще — нужно и перед сериализацией, и тесту на утечку. */
export function hasTopic(topic: string): boolean {
  return hub().has(topic);
}
