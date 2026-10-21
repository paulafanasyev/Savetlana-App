import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Свой заголовок вкладки: раньше страница входа называлась как главная. */
export const metadata: Metadata = { title: "Вход", robots: { index: false, follow: false } };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
