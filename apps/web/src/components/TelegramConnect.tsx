"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  configured: boolean;
  linked: boolean;
}

/** Карточка «Уведомления в Telegram» в кабинете продавца. */
export function TelegramConnect({ configured, linked: initialLinked }: Props) {
  const [linked, setLinked] = useState(initialLinked);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => () => {
    if (poll.current) window.clearInterval(poll.current);
  }, []);

  async function call(method: "POST" | "DELETE", action?: string) {
    const res = await fetch("/api/seller/telegram", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ action }) : undefined,
    });
    const data = (await res.json().catch(() => null)) as { url?: string | null; error?: string; message?: string } | null;
    if (!res.ok) throw new Error(data?.error ?? data?.message ?? "Не получилось. Попробуйте ещё раз.");
    return data ?? {};
  }

  function waitForLink() {
    if (poll.current) window.clearInterval(poll.current);
    const started = Date.now();
    poll.current = window.setInterval(async () => {
      if (Date.now() - started > 15 * 60_000) {
        if (poll.current) window.clearInterval(poll.current);
        return;
      }
      const res = await fetch("/api/seller/telegram").catch(() => null);
      const data = (await res?.json().catch(() => null)) as { linked?: boolean } | null;
      if (data?.linked) {
        if (poll.current) window.clearInterval(poll.current);
        setLinked(true);
        setLink(null);
        setMessage("Telegram подключён. Новые заказы и сообщения теперь придут и туда.");
      }
    }, 3000);
  }

  async function connect() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await call("POST", "link");
      if (!data.url) throw new Error("Бот пока не настроен на площадке.");
      setLink(data.url);
      window.open(data.url, "_blank", "noopener");
      waitForLink();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await call("POST", "test");
      setMessage("Отправили пробное сообщение, проверьте Telegram.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Отключить уведомления в Telegram?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await call("DELETE");
      setLinked(false);
      setMessage("Telegram отключён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-5" aria-labelledby="telegram-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="telegram-title" className="font-semibold">Уведомления в Telegram</h2>
          <p className="text-sm text-ink-soft">
            {linked
              ? "Подключено. Новые заказы, сообщения покупателей, остатки и выплаты приходят в Telegram."
              : "Узнавайте о новых заказах и сообщениях покупателей сразу, даже когда сайт закрыт."}
          </p>
        </div>
        {configured && (
          <div className="flex flex-wrap gap-2">
            {linked ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={test} disabled={busy}>Проверить</button>
                <button type="button" className="btn btn-ghost" onClick={disconnect} disabled={busy}>Отключить</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={connect} disabled={busy}>
                {busy ? "Готовлю ссылку…" : "Подключить Telegram"}
              </button>
            )}
          </div>
        )}
      </div>
      {!configured && <p className="mt-2 text-sm text-ink-faint">Скоро: площадка ещё подключает бота.</p>}
      {link && !linked && (
        <p className="mt-3 text-sm text-ink-soft">
          В Telegram нажмите «Запустить». Если окно не открылось, <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium text-svetlana-700 hover:underline">откройте бота по ссылке</a>. Ссылка действует 15 минут.
        </p>
      )}
      {message && <p className="mt-2 text-sm font-medium text-svetlana-700" role="status">{message}</p>}
      {error && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
    </section>
  );
}
