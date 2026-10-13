"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { readGuestCart, writeGuestCart, type GuestCartItem } from "@/lib/guest-cart";

/**
 * Переносит отложенные до входа товары в настоящую корзину, как только
 * человек вошёл. Пока он гость, товары ждут в браузере.
 */
export function GuestCartSync() {
  const pathname = usePathname();
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    const items = readGuestCart();
    if (items.length === 0 || busy.current) return;
    busy.current = true;
    void (async () => {
      const left: GuestCartItem[] = [];
      let added = 0;
      for (let i = 0; i < items.length; i++) {
        try {
          const res = await fetch("/api/cart/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(items[i]),
          });
          if (res.status === 401) {
            left.push(...items.slice(i));
            break;
          }
          // Товар закончился или снят с продажи: не держим его вечно.
          if (res.ok) added += 1;
        } catch {
          left.push(items[i]);
        }
      }
      writeGuestCart(left);
      busy.current = false;
      if (added > 0) router.refresh();
    })();
  }, [pathname, router]);

  return null;
}
