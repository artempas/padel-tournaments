'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TournamentDetail } from './types';

/** Столько же ждёт сервер между пульсами (`/api/tournaments/[id]/live`). */
const PING_MS = 20_000;
/** Два пропущенных пульса — это уже не связь, а её видимость. */
const STALE_MS = PING_MS * 3;

export interface LiveTournamentOptions {
  tournamentId: string;
  /**
   * Пока `true`, чужой снимок ждёт: своё неподтверждённое действие важнее.
   * Подробности — в комментарии к `hold` ниже.
   */
  busy: boolean;
  onSnapshot: (tournament: TournamentDetail) => void;
}

/**
 * Подписка экрана на живую ленту турнира.
 *
 * Счёт вносят на том телефоне, который стоит у корта, а смотрят на него со всех
 * остальных — поэтому чужой результат должен приезжать сам. Сервер рассылает
 * целый снимок турнира, и этого достаточно: накладывать его на экран экран уже
 * умеет (`applyPendingScores` работает поверх любого снимка сервера).
 */
export function useLiveTournament({
  tournamentId,
  busy,
  onSnapshot,
}: LiveTournamentOptions): void {
  // Оба значения нужны обработчику события, а он живёт дольше рендера. Через
  // ref, а не через зависимости эффекта: иначе каждое действие пользователя
  // пересоздавало бы `EventSource` — то есть переподключение и лишний снимок
  // на каждый введённый счёт.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const applyRef = useRef(onSnapshot);
  applyRef.current = onSnapshot;

  /**
   * Снимок, приехавший в неподходящий момент, ждёт здесь — и только последний:
   * предыдущий заведомо хуже.
   *
   * Зачем ждать: снимок мог быть собран на сервере до того, как зафиксировалась
   * собственная правка, и тогда он описывает мир до неё. Применить его — значит
   * на глазах откатить введённый счёт и через мгновение вернуть его ответом
   * сервера, то есть мигнуть ровно тем числом, которое человек только что
   * набрал. Выбросить — потерять чужой результат до следующего события, а его
   * может не быть час. Отложить: без мигания и без потери, окно — один
   * round-trip.
   */
  const held = useRef<TournamentDetail | null>(null);
  /** Когда последний раз что-то приходило — по этому watchdog судит о связи. */
  const lastEventAt = useRef(Date.now());
  /** Смена номера пересоздаёт соединение: `EventSource` не умеет `reconnect()`. */
  const [generation, setGeneration] = useState(0);

  const flush = useCallback(() => {
    if (busyRef.current) return;
    const snapshot = held.current;
    if (!snapshot) return;
    held.current = null;
    applyRef.current(snapshot);
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/tournaments/${tournamentId}/live`);

    const beat = () => {
      lastEventAt.current = Date.now();
    };

    source.addEventListener('open', beat);
    // Пульс ничего не несёт, кроме самого факта: соединение живо.
    source.addEventListener('ping', beat);
    source.addEventListener('tournament', (event) => {
      beat();
      try {
        held.current = JSON.parse((event as MessageEvent<string>).data) as TournamentDetail;
      } catch {
        // Обрезанный кадр разбирать нечем; следующий приедет целым.
        return;
      }
      flush();
    });

    // Закрытие здесь — то, что вызывает abort на сервере, а тот отписывает от
    // рассылки. Этим история утечек на клиенте и исчерпывается.
    return () => source.close();
    // `generation` в зависимостях — это и есть принудительное переподключение.
  }, [tournamentId, generation, flush]);

  // Освободились — отложенный снимок едет на экран.
  useEffect(() => {
    if (!busy) flush();
  }, [busy, flush]);

  /**
   * Watchdog: заметить мёртвое соединение, о котором браузер не знает.
   *
   * `EventSource` переподключается сам, только когда разрыв заметил браузер. У
   * телефона, который заблокировали и разблокировали — то есть у каждого
   * телефона на корте, — бывает иначе: `readyState` всё ещё `OPEN`, сокет
   * мёртв, кадры не идут. Сервер это поймёт по своему пульсу за двадцать
   * секунд и отпустит подписчика, а клиент не поймёт ничего и останется с
   * устаревшим экраном навсегда.
   *
   * Судим по времени последнего кадра, а не по `readyState`: так закрываются
   * сразу оба состояния — и зомби с `OPEN`, и застрявший `CONNECTING`.
   */
  useEffect(() => {
    const checkStale = () => {
      // Скрытую вкладку не трогаем: смотреть на неё некому, а переподключение
      // стоит запроса к базе. Проснётся — проверимся на `visibilitychange`,
      // ровно в тот момент, когда результат кому-то нужен. В спящей вкладке
      // браузер таймеры душит или глушит совсем, так что это не дубль
      // интервала, а основной путь.
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastEventAt.current < STALE_MS) return;
      lastEventAt.current = Date.now();
      setGeneration((n) => n + 1);
    };

    const timer = setInterval(checkStale, PING_MS);
    document.addEventListener('visibilitychange', checkStale);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', checkStale);
    };
  }, []);
}
