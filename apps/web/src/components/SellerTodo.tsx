"use client";

/**
 * Блок «Что сделать сегодня» на главной кабинета. Обновляется сам раз в
 * минуту и при возвращении на вкладку, как счётчики в меню: продавец видит
 * новый заказ или спор, не перезагружая страницу (и не теряя чат со Светланой).
 * У скидок, которые скоро закончатся, есть кнопка «Продлить на 7 дней».
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { extendDoneText, parseTodoItems, PROMO_EXTEND_DAYS, type TodoItem } from "@/lib/seller-todo";

const REFRESH_MS = 60_000;

/** Свежий список дел с сервера. null: нет сети или странный ответ, оставляем прежний. */
async function loadTodo(): Promise<TodoItem[] | null> {
  try {
    const response = await fetch("/api/seller/todo", { cache: "no-store" });
    if (!response.ok) return null;
    return parseTodoItems(await response.json());
  } catch {
    return null;
  }
}

export function SellerTodo({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [extending, setExtending] = useState(false);
  const [extendMessage, setExtendMessage] = useState<string | null>(null);

  async function extendEnding() {
    setExtending(true);
    setExtendMessage(null);
    try {
      const response = await fetch("/api/seller/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extend_ending", days: PROMO_EXTEND_DAYS }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; extended?: unknown; skipped?: unknown };
      if (!response.ok) {
        setExtendMessage(typeof body.error === "string" ? body.error : "Не удалось продлить скидки");
        return;
      }
      const extended = Array.isArray(body.extended) ? body.extended.length : 0;
      const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;
      setExtendMessage(extendDoneText(extended, skipped));
      const next = await loadTodo();
      if (next) setItems(next);
    } catch {
      setExtendMessage("Нет связи с сервером");
    } finally {
      setExtending(false);
    }
  }

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const next = await loadTodo();
      if (!stopped && next) setItems(next);
    }
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <section aria-live="polite" className={`rounded-xl border p-5 ${items.length > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
      <h2 className="font-semibold">Что сделать сегодня</h2>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.kind} className="flex flex-wrap items-center gap-2">
              <Link href={item.href} className="font-medium text-ink underline underline-offset-2 hover:text-svetlana-700">{item.text}</Link>
              {item.kind === "promo_ending" && (
                <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={extending} onClick={() => void extendEnding()}>
                  {extending ? "Продлеваем…" : `Продлить на ${PROMO_EXTEND_DAYS} дней`}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">Срочных дел нет. Новые заказы, сообщения покупателей и споры появятся здесь.</p>
      )}
      {extendMessage && <p className="mt-2 text-sm text-ink-soft" role="status">{extendMessage}</p>}
    </section>
  );
}
