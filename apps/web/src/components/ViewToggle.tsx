"use client";

import { usePathname } from "next/navigation";

/**
 * Ссылка в подвале: переключить полную/мобильную версию и остаться на той же
 * странице. Работает и там, где у браузера нет своего переключателя (Telegram).
 */
export function ViewToggle({ desktop }: { desktop: boolean }) {
  const pathname = usePathname() || "/";
  const mode = desktop ? "mobile" : "desktop";
  const href = `/api/view?mode=${mode}&back=${encodeURIComponent(pathname)}`;
  return (
    <a
      href={href}
      rel="nofollow"
      data-testid="view-toggle"
      className="hover:text-svetlana-700"
      onClick={(e) => {
        // Сохраняем и параметры поиска, чтобы фильтры каталога не сбросились.
        e.preventDefault();
        const back = window.location.pathname + window.location.search;
        window.location.href = `/api/view?mode=${mode}&back=${encodeURIComponent(back)}`;
      }}
    >
      {desktop ? "📱 Мобильная версия" : "🖥 Полная версия"}
    </a>
  );
}
