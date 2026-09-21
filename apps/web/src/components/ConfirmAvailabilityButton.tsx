"use client";

import { useState } from "react";

export function ConfirmAvailabilityButton({
  productId,
  confirmed,
}: {
  productId: string;
  confirmed: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const label = confirmed ? "Продлить" : "Подтвердить наличие";

  return (
    <button
      className="btn btn-ghost px-3 py-1.5 text-xs"
      disabled={state === "busy" || state === "ok"}
      onClick={async () => {
        setState("busy");
        try {
          const res = await fetch(`/api/seller/products/${productId}/confirm-availability`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!res.ok) throw new Error("confirm failed");
          setState("ok");
        } catch {
          setState("err");
        }
      }}
    >
      {state === "busy" && "Сохраняем…"}
      {state === "idle" && label}
      {state === "ok" && "✓ Подтверждено"}
      {state === "err" && "Не удалось"}
    </button>
  );
}
