'use client';

import { useCallback, useRef, useState } from 'react';
import { failureMessage } from './request';

/**
 * Общее правило клиента: экран показывает результат действия сразу, запрос
 * уходит следом, а отказ сервера откатывает изменение и объясняется словами.
 * На корте связь хуже игроков, и ждать ответа, чтобы увидеть собственный
 * клик, там некогда.
 *
 * Не `useOptimistic` из React: тот держит правку до конца transition и
 * возвращается к базовому значению. Базовое здесь приходит из props ровно
 * один раз — после `router.refresh()` компонент остаётся со своим состоянием,
 * и откатываться было бы к устаревшему. Подтверждает изменение сам ответ.
 */
export interface Mutation<T> {
  /** Что показать немедленно. */
  next: (current: T) => T;
  /**
   * Как отменить именно это изменение. Берёт текущее состояние, а не снимок
   * на момент клика: пока запрос шёл, на экране могли появиться другие
   * правки, и они не должны пропасть вместе с откатом.
   */
  undo: (current: T) => T;
  /** Запрос за изменением. Что вернёт, то и станет состоянием; `void` — оставить своё. */
  send: () => Promise<T | void>;
  /** Сообщение об отказе, если сервер не прислал собственного. */
  message: string;
  /** Отдельный текст на случай, когда до сервера просто не дошли. */
  offline?: string;
}

export interface OptimisticState<T> {
  value: T;
  /** Последний отказ — уже откаченный, показать и забыть. */
  error: string | null;
  /** Сколько изменений ещё не подтверждено сервером. */
  unconfirmed: number;
  mutate: (mutation: Mutation<T>) => void;
  /** Состояние от сервера, а не от пользователя: без отката и без ошибки. */
  set: (value: T) => void;
  setError: (message: string | null) => void;
}

export function useOptimisticState<T>(initial: T): OptimisticState<T> {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(0);

  // Значение нужно и вне рендера: ответ приходит когда угодно, а откатывать
  // надо от состояния на этот момент.
  const latest = useRef(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback((next: T) => {
    latest.current = next;
    setValue(next);
  }, []);

  const mutate = useCallback(
    (mutation: Mutation<T>) => {
      setError(null);
      setUnconfirmed((n) => n + 1);
      commit(mutation.next(latest.current));

      const run = async () => {
        try {
          const confirmed = await mutation.send();
          if (confirmed !== undefined) commit(confirmed);
        } catch (err) {
          commit(mutation.undo(latest.current));
          setError(failureMessage(err, mutation.message, mutation.offline));
        } finally {
          setUnconfirmed((n) => n - 1);
        }
      };

      // Запросы выстроены в очередь — два изменения одного ресурса, ушедшие
      // разом, иначе перезаписали бы друг друга ответами. Экрана это не
      // касается: он всё показал ещё до очереди.
      queue.current = queue.current.then(run, run);
    },
    [commit],
  );

  return { value, error, unconfirmed, mutate, set: commit, setError };
}
