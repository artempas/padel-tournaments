import { NextResponse } from 'next/server';
import { route } from '@/lib/api';
import { requireMembershipForTournament } from '@/lib/club-context';
import { subscribe, tournamentTopic, type LiveFrame } from '@/lib/live';
import { loadTournament } from '@/lib/tournaments';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Пульс: держит поток живым в прокси и даёт клиенту заметить мёртвый сокет. */
const PING_MS = 20_000;
/** Через сколько браузер переподключается сам. */
const RETRY_MS = 5_000;

function frame({ event, data }: LiveFrame): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/**
 * Живая лента турнира.
 *
 * Отдаёт текущий снимок сразу при подключении, дальше — каждый следующий, как
 * только он появится. Первый кадр здесь не вежливость, а замена
 * перепроигрыванию пропущенного: телефон засыпает в кармане, соединение молча
 * умирает, `EventSource` переподключается — и одного свежего снимка достаточно,
 * чтобы экран снова был прав. Поэтому у кадров нет `id:`, и `Last-Event-ID`
 * браузер не пришлёт никогда.
 */
export const GET = route(async (request: Request, context: Context) => {
  const { id } = await context.params;

  // Единственный поход в базу за подписчика — и он до стрима, чтобы отказ
  // достался клиенту обычным JSON (401/404), как во всех остальных роутах, а
  // не оборванным потоком. Права те же, что у внесения счёта.
  const { club } = await requireMembershipForTournament(id);
  const snapshot = await loadTournament(id, club.id);

  // Тема берётся из загруженного турнира, а не из адреса: Postgres сравнивает
  // uuid без учёта регистра, так что `id` из ссылки может быть записан иначе,
  // чем тот, по которому рассылает `publishTournament`, — и подписка молча
  // слушала бы тему, в которую никто не пишет.
  const topic = tournamentTopic(snapshot.id);
  const encoder = new TextEncoder();

  // Закрытие поднято из `start`, потому что звать его приходится и снаружи —
  // из `cancel`.
  let close = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let unsubscribe: (() => void) | null = null;
      let ping: ReturnType<typeof setInterval> | null = null;

      const write = (text: string): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Контроллер уже закрыт — соединения больше нет.
          close();
        }
      };

      // Идемпотентно и нарочно: разрыв приходит двумя разными путями (см. ниже),
      // и какой сработает первым — заранее неизвестно.
      close = (): void => {
        if (!open) return;
        open = false;
        if (ping !== null) clearInterval(ping);
        unsubscribe?.();
        request.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // Уже закрыт — своё дело он сделал.
        }
      };

      write(`retry: ${RETRY_MS}\n\n`);
      write(frame({ event: 'tournament', data: JSON.stringify(snapshot) }));

      // Снимок загружен до `new ReadableStream`, и это важно. В варианте с
      // `async start` между подпиской и первым кадром появилась бы точка
      // `await`, и запись, случившаяся в этот момент, уехала бы подписчику
      // раньше более старого снимка — клиент остался бы с устаревшим до
      // следующей записи. Здесь такого окна нет: конструктор зовёт `start`
      // синхронно, и между загрузкой и `subscribe` нет ни одного `await`.
      unsubscribe = subscribe(topic, (next) => write(frame(next)));

      // Пульс — именованным событием, а не комментарием `:ping`: комментарий до
      // JS не доходит, и клиент не смог бы отличить живое соединение от зомби
      // (телефон заблокировали и разблокировали — сокет мёртв, readyState всё
      // ещё OPEN). Непустой `data` обязателен: событие с пустым буфером данных
      // браузер не диспатчит вовсе.
      ping = setInterval(() => write(frame({ event: 'ping', data: '1' })), PING_MS);

      // Обрыв со стороны клиента (закрыли EventSource, умер сокет)...
      request.signal.addEventListener('abort', close);
      // ...включая случай, когда он уже случился: на сработавшем сигнале
      // слушатель не позовут никогда, и интервал остался бы жить один.
      if (request.signal.aborted) close();
    },
    // ...и отмена чтения со стороны обвязки Next — разные события, и ведут себя
    // по-разному в dev и в проде. Пропустить один из путей значит оставить
    // таймер на 20 секунд и замыкание над целым турниром на каждый брошенный
    // телефон: за вечер незаметно, за месяц аптайма заметно.
    cancel() {
      close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // `no-transform` — чтобы gzip не переупаковал поток и не вернул
      // буферизацию, которую снимает заголовок ниже.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Без этого nginx (а на NAS турнир смотрят через его reverse proxy)
      // держит первое событие, пока не заполнится буфер: в dev всё работает, в
      // проде фича выглядит сломанной.
      'x-accel-buffering': 'no',
    },
  });
});
