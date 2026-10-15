"use client";

/**
 * Блок «Что сделать сегодня» на странице «Мои заказы»: заказы, которые ждут
 * действия покупателя (оплатить, забрать, проверить и оставить отзыв, споры).
 * Тот же список, что Светлана даёт на «что мне сделать сегодня?». Обновляется
 * раз в минуту и при возвращении на вкладку. Если дел нет, блок не показывается.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseBuyerTodoItems, type BuyerTodoItem } from "@/lib/buyer-todo";

const REFRESH_MS = 60_000;

async function loadBuyerTodo(): Promise<BuyerTodoItem[] | null> {
  try {
    const response = await fetch("/api/orders/todo", { cache: "no-store" });
    if (!response.ok) return null;
    return parseBuyerTodoItems(await response.json());
  } catch {
    return null;
  }
}

export function BuyerTodo() {
  const [items, setItems] = useState<BuyerTodoItem[]>([]);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const next = await loadBuyerTodo();
      if (!stopped && next) setItems(next);
    }
    void refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <section aria-live="polite" className="card mb-4 border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-ink">Что сделать сегодня</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.kind}>
            <Link href={item.href} className="font-medium text-ink underline underline-offset-2 hover:text-svetlana-700">{item.text}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
