'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import ThemeToggle from './ThemeToggle';
import YandexButton from './YandexButton';
import { failureMessage, request } from '@/lib/request';

type Mode = 'login' | 'register';

function friendlyError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError') return 'Вход отменён или истекло время ожидания';
    if (err.name === 'InvalidStateError') return 'Passkey для этого устройства уже создан';
    if (err.name === 'SecurityError') return 'Домен не разрешён для passkey — проверьте RP_ID';
  }
  return failureMessage(err, 'Что-то пошло не так', 'Нет сети — вход требует связи с сервером');
}

function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

export default function AuthScreen({
  next = '/tournaments',
  intro,
  yandex = false,
  notice,
}: {
  /** Куда вести после входа: с ссылки-приглашения — обратно на неё. */
  next?: string;
  /** Строка над формой, если человек пришёл не просто так. */
  intro?: string;
  /** Подключён ли вход через Яндекс ID — решают переменные окружения. */
  yandex?: boolean;
  /** Чем кончился прошлый поход на Яндекс, если он был. */
  notice?: string;
} = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function handleRegister() {
    const { options } = await postJson<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
      '/api/auth/register/options',
      { username },
    );
    const response = await startRegistration({ optionsJSON: options });
    await postJson('/api/auth/register/verify', { response });
  }

  async function handleLogin() {
    const { options } = await postJson<{
      options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
    }>('/api/auth/login/options', username.trim() ? { username } : {});
    const response = await startAuthentication({ optionsJSON: options });
    await postJson('/api/auth/login/verify', { response });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') await handleRegister();
      else await handleLogin();
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <header className="text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl text-accent-ink">
          🎾
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Падел Турниры</h1>
        <p className="mt-2 text-sm text-muted">
          {intro ??
            'Американо: каждый играет в паре с каждым. Расписание, счёт и итоговая таблица.'}
        </p>
      </header>

      <div className="card p-5">
        {/* Сообщение о прошлой попытке входа через Яндекс: приходит в адресе
            после коллбэка и живёт до следующей навигации. */}
        {notice && (
          <p className="mb-5 rounded-xl border border-line bg-ink px-4 py-3 text-sm text-muted">
            {notice}
          </p>
        )}

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`tap rounded-lg px-3 text-sm font-semibold transition ${
                mode === m ? 'bg-surface-2 text-text' : 'text-muted'
              }`}
            >
              {m === 'login' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">
              Имя{' '}
              {mode === 'login' && <span className="font-normal">(можно не заполнять)</span>}
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete={mode === 'login' ? 'username webauthn' : 'username'}
              placeholder={mode === 'login' ? 'Оставьте пустым для выбора passkey' : 'Например, Артём'}
              className="tap rounded-xl border border-line bg-ink px-4 text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              {error}
            </p>
          )}

          {!supported && (
            <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
              Этот браузер не поддерживает passkey. Откройте приложение в Safari, Chrome или Edge.
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !supported || (mode === 'register' && username.trim().length < 2)}
            className="tap rounded-xl bg-accent px-4 font-bold text-accent-ink transition disabled:opacity-40"
          >
            {busy
              ? 'Подождите…'
              : mode === 'register'
                ? 'Создать passkey'
                : 'Войти через passkey'}
          </button>
        </form>

        {/* Кнопки нет, пока не заданы ключи приложения Яндекса: показывать
            вход, который не работает, хуже, чем не показывать его вовсе. */}
        {yandex && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-line" />
              или
              <span className="h-px flex-1 bg-line" />
            </div>
            <YandexButton next={next} />
          </>
        )}
      </div>

      <p className="text-center text-xs leading-relaxed text-muted">
        {yandex
          ? 'Вход по passkey — отпечаток, Face ID или PIN устройства — либо через Яндекс ID. Паролей нет.'
          : 'Вход только по passkey — отпечаток, Face ID или PIN устройства. Паролей нет.'}
      </p>

      {/* Согласие берётся здесь, а не отдельной галочкой: галочка, без которой
          кнопка не нажимается, ничего не добавляет к осведомлённости — её
          ставят не глядя. Ссылка же ведёт на открытую страницу, доступную до
          входа, иначе соглашаться было бы не с чем. */}
      <p className="text-center text-xs leading-relaxed text-muted">
        {mode === 'register' ? 'Создавая аккаунт' : 'Продолжая'}, вы соглашаетесь с{' '}
        <Link href="/privacy" className="font-semibold text-text underline">
          политикой обработки персональных данных
        </Link>
        .
      </p>
    </main>
  );
}
