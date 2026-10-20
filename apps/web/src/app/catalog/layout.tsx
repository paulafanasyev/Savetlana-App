import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/seo";

/** Свой заголовок и описание каталога: раньше он совпадал с главной, и поисковик видел две одинаковые страницы. */
export const metadata: Metadata = {
  title: "Каталог товаров",
  description: `Каталог ${SITE_NAME}: товары продавцов с безопасной сделкой. Поиск по названию, фильтры по цене и категории, помощь Светланы в выборе.`,
  alternates: { canonical: "/catalog" },
  openGraph: {
    title: `Каталог товаров · ${SITE_NAME}`,
    description: "Товары продавцов с безопасной сделкой и помощью Светланы",
    siteName: SITE_NAME,
    locale: "ru_RU",
    type: "website",
  },
};

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return children;
}
