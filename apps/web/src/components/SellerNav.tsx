"use client";

/**
 * Меню кабинета продавца со счётчиками. Счётчики сами обновляются раз в
 * минуту и при возвращении на вкладку, без перезагрузки страницы, поэтому
 * недописанный ответ покупателю не пропадает.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { badgeLabel, badgeText, type BadgeKind } from "@/lib/badge-text";

export interface NavCounts {
  orders: number;
  messages: number;
  disputes: number;
}

const BADGE_FOR: Record<string, BadgeKind> = {
  "/seller/orders": "orders",
  "/seller/messages": "messages",
  "/seller/disputes": "disputes",
};

const REFRESH_MS = 60_000;

function isCounts(value: unknown): value is NavCounts {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["orders", "messages", "disputes"].every((k) => typeof v[k] === "number");
}

export function SellerNav({ items, initial }: { items: readonly (readonly [string, string])[]; initial: NavCounts }) {
  const [counts, setCounts] = useState<NavCounts>(initial);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/seller/badges", { cache: "no-store" });
        if (!response.ok) return;
        const json: unknown = await response.json();
        if (!stopped && isCounts(json)) setCounts(json);
      } catch {
        // нет сети: оставляем прежние числа
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
    <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto whitespace-nowrap px-4 py-2">
      {items.map(([href, label]) => {
        const kind = BADGE_FOR[href];
        const n = kind ? counts[kind] : 0;
        const text = kind ? badgeText(n) : "";
        return (
          <Link href={href} key={href} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink">
            {label}
            {text && kind && (
              <span className="min-w-[1.25rem] rounded-full bg-red-600 px-1.5 text-center text-xs font-semibold leading-5 text-white" aria-label={badgeLabel(kind, n)}>
                {text}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
