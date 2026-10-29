/**
 * Кнопка входа через собственный SSO (authentik и т. п.).
 *
 * Как и YandexButton, это обычная ссылка: переход должен быть навигацией
 * основного окна, иначе экрану входа SSO негде открыться. Фирменного
 * оформления у своего сервера нет, поэтому кнопка нейтральная — в цветах
 * приложения, с ключом вместо логотипа.
 */
export default function SsoButton({
  name,
  next,
  label,
}: {
  /** Имя провайдера из SSO_NAME — под ним человек знает свой вход. */
  name: string;
  /** Куда вернуть после входа: с ссылки-приглашения — обратно на неё. */
  next?: string;
  label?: string;
}) {
  const href = next ? `/api/auth/sso?next=${encodeURIComponent(next)}` : '/api/auth/sso';

  return (
    <a
      href={href}
      className="tap flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface-2 px-3 text-sm font-semibold text-text transition active:opacity-80"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="M10.7 12.3 20 3M16 7l3 3M14 9l2 2" />
      </svg>
      {label ?? `Войти через ${name}`}
    </a>
  );
}
