/**
 * Кнопка «Войти с Яндекс ID».
 *
 * Обычная ссылка, а не кнопка с обработчиком: переход должен быть навигацией
 * основного окна — иначе экрану согласия Яндекса негде открыться. Клиентский
 * JS здесь не нужен вовсе, поэтому компонент серверный.
 *
 * Фирменный красный и логотип — требование Яндекса к оформлению входа: человек
 * узнаёт кнопку по виду раньше, чем читает надпись.
 */
export default function YandexButton({
  next,
  label = 'Войти с Яндекс ID',
}: {
  /** Куда вернуть после входа: с ссылки-приглашения — обратно на неё. */
  next?: string;
  label?: string;
}) {
  const href = next ? `/api/auth/yandex?next=${encodeURIComponent(next)}` : '/api/auth/yandex';

  return (
    <a
      href={href}
      className="tap flex items-center justify-center gap-2 rounded-xl bg-[#FC3F1D] px-4 font-bold text-white transition active:scale-[0.99]"
    >
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-base font-black leading-none text-[#FC3F1D]"
      >
        Я
      </span>
      {label}
    </a>
  );
}
