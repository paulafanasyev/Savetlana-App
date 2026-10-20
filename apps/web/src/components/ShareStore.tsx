"use client";

import { useEffect, useState } from "react";

/**
 * «Поделиться магазином» на главной кабинета: ссылка на публичную страницу магазина,
 * кнопки Telegram и WhatsApp и копирование. На телефоне открывается системное меню «Поделиться».
 */
export function ShareStore({ sellerId, name, hasProducts }: { sellerId: string; name: string; hasProducts: boolean }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  const path = `/sellers/${sellerId}`;
  const url = origin ? `${origin}${path}` : path;
  const text = `Мой магазин «${name}» на АИКО: оплата через безопасную сделку.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: name, text, url });
    } catch {
      /* человек закрыл меню */
    }
  }

  return (
    <section className="rounded-xl border p-5" aria-labelledby="share-store" data-testid="share-store">
      <h2 id="share-store" className="font-semibold">Поделиться магазином</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {hasProducts
          ? "Отправьте ссылку своим покупателям и подписчикам: в мессенджере она покажется с названием и фото."
          : "Ссылка уже работает, но в магазине пока нет опубликованных товаров. Лучше делиться после первого товара."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input readOnly value={url} aria-label="Ссылка на магазин" className="input w-full max-w-md" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-primary" onClick={copy}>{copied ? "Скопировано" : "Скопировать"}</button>
        {canShare && <button type="button" className="btn btn-ghost" onClick={share}>Поделиться…</button>}
        <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}>Telegram</a>
        <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}>WhatsApp</a>
        <a className="btn btn-ghost" href={path}>Открыть</a>
      </div>
      <span className="sr-only" role="status">{copied ? "Ссылка скопирована" : ""}</span>
    </section>
  );
}
