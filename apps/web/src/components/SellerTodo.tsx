"use client";

/**
 * Блок «Что сделать сегодня» на главной кабинета. Обновляется сам раз в
 * минуту и при возвращении на вкладку, как счётчики в меню: продавец видит
 * новый заказ или спор, не перезагружая страницу (и не теряя чат со Светланой).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseTodoItems, type TodoItem } from "@/lib/seller-todo";

const REFRESH_MS = 60_000;

export function SellerTodo({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/seller/todo", { cache: "no-store" });
        if (!response.ok) return;
        const next = parseTodoItems(await response.json());
        if (!stopped && next) setItems(next);
      } catch {
        // нет сети: оставляем прежний список
      }
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
            <li key={item.kind}>
              <Link href={item.href} className="font-medium text-ink underline underline-offset-2 hover:text-svetlana-700">{item.text}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">Срочных дел нет. Новые заказы, сообщения покупателей и споры появятся здесь.</p>
      )}
    </section>
  );
}
