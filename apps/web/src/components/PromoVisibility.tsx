"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Реклама не показывается на юридических и служебных страницах: человек пришёл
 * прочитать условия, войти или работать в админке. Путь читаем на клиенте, чтобы
 * блок прятался и при переходе по ссылке без перезагрузки.
 */
const HIDDEN = ["/legal", "/privacy", "/contacts", "/login", "/register", "/admin", "/checkout", "/reset-password"];

export function isPromoHidden(pathname: string): boolean {
  return HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function PromoVisibility({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (isPromoHidden(pathname)) return null;
  return <>{children}</>;
}
