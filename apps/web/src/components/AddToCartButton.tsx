"use client";

import Link from "next/link";
import { useState } from "react";
import { rub } from "@/lib/format";

interface Variant { id: string; name: string; priceKopecks: number }

export function AddToCartButton({ productId, variants = [], outOfStock = false }: { productId: string; variants?: Variant[]; outOfStock?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string>(variants[0]?.id ?? "");

  if (outOfStock) {
    return <button className="btn btn-ghost w-full md:w-auto" disabled>Нет в наличии</button>;
  }

  async function add() {
    setState("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: 1, variantId: variantId || undefined }),
      });
      if (res.status === 401) {
        location.assign("/login?next=" + encodeURIComponent(location.pathname));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(data.error ?? "Не удалось добавить товар");
        return;
      }
      setState("ok");
    } catch {
      setState("error");
      setMessage("Нет связи с сервером. Попробуйте ещё раз.");
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 md:w-auto">
      {variants.length > 0 && (
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink">Вариант</span>
          <select className="input" value={variantId} onChange={(e) => { setVariantId(e.target.value); setState("idle"); }}>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name} · {rub(v.priceKopecks)}</option>)}
          </select>
        </label>
      )}
      <button className="btn btn-accent w-full md:w-auto" disabled={state === "loading"} onClick={() => void add()}>
        {state === "loading" ? "Добавляем…" : state === "ok" ? "✓ В корзине, добавить ещё" : "В корзину"}
      </button>
      {state === "ok" && <Link href="/cart" className="text-sm text-svetlana-700 hover:underline">Перейти в корзину</Link>}
      {message && <p className="text-xs text-bad" role="alert">{message}</p>}
    </div>
  );
}
