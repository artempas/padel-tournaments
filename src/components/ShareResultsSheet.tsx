'use client';

import { useEffect, useState } from 'react';
import { resultsCardFile, resultsSummary, type ResultsCardData } from '@/lib/results-card';

interface Props {
  data: ResultsCardData;
  onClose: () => void;
}

/**
 * Картинка собирается при открытии шторки, а не по кнопке «Поделиться»:
 * системный диалог отправки открывается только по живому нажатию, и ожидание
 * canvas между нажатием и вызовом это нажатие обесценивает. Заодно видно, чем
 * именно делишься.
 */
export default function ShareResultsSheet({ data, onClose }: Props) {
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;

    resultsCardFile(data).then(
      (file) => {
        if (!alive) return;
        url = URL.createObjectURL(file);
        setImage({ file, url });
      },
      () => {
        if (alive) setError('Не удалось собрать картинку');
      },
    );

    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Отправка файлов есть не везде: на десктопе обычно остаётся только скачать.
  const canShare =
    image !== null &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [image.file] });

  async function share() {
    if (!image) return;
    const { headline, detail } = resultsSummary(data);
    try {
      await navigator.share({
        files: [image.file],
        title: data.name,
        text: `${data.name} — ${headline.toLowerCase()}. ${detail}`,
      });
    } catch (err) {
      // Закрытый диалог — это не отказ, а решение пользователя.
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Не удалось поделиться — картинку можно сохранить и отправить самому');
    }
  }

  function download() {
    if (!image) return;
    const link = document.createElement('a');
    link.href = image.url;
    link.download = image.file.name;
    link.click();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Поделиться результатами"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Поделиться результатами</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-muted"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {image ? (
          <img
            src={image.url}
            alt="Картинка с итоговой таблицей турнира"
            className="w-full rounded-2xl border border-line"
          />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-line bg-ink text-sm text-muted">
            {error ?? 'Собираем картинку…'}
          </div>
        )}

        {error && image && (
          <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {canShare && (
            <button
              type="button"
              onClick={() => void share()}
              className="tap rounded-xl bg-accent px-4 font-bold text-accent-ink"
            >
              Поделиться
            </button>
          )}
          <button
            type="button"
            onClick={download}
            disabled={!image}
            className={`tap rounded-xl px-4 disabled:opacity-40 ${
              canShare
                ? 'border border-line font-medium text-muted'
                : 'bg-accent font-bold text-accent-ink'
            }`}
          >
            Скачать картинку
          </button>
        </div>
      </div>
    </div>
  );
}
