"use client";

/**
 * Блок «Что сделать сегодня» для покупателя: заказы, которые ждут его действия
 * (оплатить, забрать, проверить и оставить отзыв, споры). Стоит на главной и
 * на странице «Мои заказы». Тот же список, что Светлана даёт на «что мне
 * сделать сегодня?». Обновляется раз в минуту и при возвращении на вкладку.
 * Если дел нет или человек не вошёл, блок не показывается, а гость больше
 * не спрашивает сервер.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseBuyerTodoItems, type BuyerTodoItem } from "@/lib/buyer-todo";

const REFRESH_MS = 60_000;

type Loaded = { items: BuyerTodoItem[] } | { stop: true } | null;

async function loadBuyerTodo(): Promise<Loaded> {
  try {
    const response = await fetch("/api/orders/todo", { cache: "no-store" });
    // Гость или заблокированный аккаунт: дел по заказам нет, перестаём спрашивать.
    if (response.status === 401 || response.status === 403) return { stop: true };
    if (!response.ok) return null;
    const items = parseBuyerTodoItems(await response.json());
    return items ? { items } : null;
  } catch {
    return null;
  }
}

export function BuyerTodo({ showAllLink = false }: { showAllLink?: boolean }) {
  const [items, setItems] = useState<BuyerTodoItem[]>([]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const onVisible = () => void refresh();
    function stop() {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    }
    async function refresh() {
      if (stopped || document.visibilityState !== "visible") return;
      const next = await loadBuyerTodo();
      if (stopped || !next) return;
      if ("stop" in next) return stop();
      setItems(next.items);
    }
    void refresh();
    timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return stop;
  }, []);

  if (items.length === 0) return null;
  return (
    <section aria-live="polite" className="card mb-4 border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-ink">Что сделать сегодня</h2>
        {showAllLink && (
          <Link href="/orders" className="text-xs text-ink-soft hover:underline">Все заказы</Link>
        )}
      </div>
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
