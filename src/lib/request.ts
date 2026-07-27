/**
 * Запросы к своему API по одним правилам для всех экранов: удачный ответ — это
 * разобранный JSON, отказ — брошенная ошибка с текстом от сервера. Браузерный
 * модуль: серверный код ходит в базу напрямую, а не через HTTP.
 */
export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    // Тело у нас всегда JSON — заголовок незачем повторять на каждом вызове.
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  });

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? 'Не удалось выполнить запрос');
  }
  return data as T;
}

/**
 * Текст для пользователя по брошенной ошибке. `fetch` бросает `TypeError`
 * ровно тогда, когда до сервера не достучались, — и это стоит отличать от
 * отказа самого сервера: в первом случае виновата связь, а не введённое.
 */
export function failureMessage(
  error: unknown,
  fallback: string,
  offline = 'Нет сети — попробуйте ещё раз, когда появится связь',
): string {
  if (error instanceof TypeError) return offline;
  return error instanceof Error && error.message ? error.message : fallback;
}
