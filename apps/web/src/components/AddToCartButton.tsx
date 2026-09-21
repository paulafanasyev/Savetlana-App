"use client";

import { useState } from "react";

export function AddToCartButton({ productId }: { productId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  return (
    <button
      className="btn btn-accent w-full md:w-auto"
      disabled={state === "loading"}
      onClick={async () => {
        setState("loading");
        try {
          const add = await fetch("/api/cart/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, quantity: 1 }),
          });
          if (!add.ok) {
            const data = await add.json().catch(() => ({}));
            if (add.status === 401) {
              location.assign("/login?next=" + encodeURIComponent(location.pathname));
              return;
            }
            throw new Error(data.error ?? "add failed");
          }
          setState("ok");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "loading" && "Добавляем…"}
      {state === "idle" && "В корзину"}
      {state === "ok" && "✓ В корзине"}
      {state === "error" && "Не удалось — войдите в аккаунт"}
    </button>
  );
}
