import type { Metadata } from "next";
import type { ReactNode } from "react";
import { env } from "@/lib/env";

/** Карточка ссылки на /sell в мессенджерах и соцсетях; картинка рядом, в opengraph-image.tsx. */
export function generateMetadata(): Metadata {
  const fee = String(env.platformFeePercent).replace(".", ",");
  const title = "Продавайте на АИКО";
  const description = `Комиссия ${fee}% с продажи. Самозанятых одобряем по данным ФНС, карточки товаров помогает составить ИИ-помощник Светлана.`;
  return {
    openGraph: { title, description, url: "/sell", siteName: "АИКО", locale: "ru_RU", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function SellLayout({ children }: { children: ReactNode }) {
  return children;
}
