"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AikoLogo } from "@/components/AikoLogo";

const PRIMARY = [
  { href: "/", label: "Главная" },
  { href: "/catalog", label: "Каталог" },
  { href: "/classifieds", label: "Объявления" },
  { href: "/svetlana", label: "Светлана" },
];

const USER_MENU: [string, string][] = [
  ["/profile", "Мой профиль"],
  ["/orders", "Мои заказы"],
  ["/messages", "Сообщения"],
  ["/disputes", "Возвраты и споры"],
  ["/favorites", "Избранное"],
  ["/gifts", "Подарки"],
  ["/recommendations", "Рекомендации"],
  ["/notifications", "Уведомления"],
  ["/privacy", "Конфиденциальность"],
];

const navLink = "rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink";

export function Header() {
  const [user, setUser] = useState<{ name?: string; email: string; role: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  // Close menus on navigation and on Escape.
  useEffect(() => {
    setOpen(false);
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const links = [
    ...PRIMARY,
    ...(user?.role === "SELLER" ? [{ href: "/seller", label: "Кабинет продавца" }] : []),
    ...(user?.role === "ADMIN" ? [{ href: "/admin", label: "Админка" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-surface-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="btn btn-ghost px-3 py-2 text-sm md:hidden"
          aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="АИКО, на главную">
          <AikoLogo />
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Основная навигация">
          {links.map((l) => (
            <Link key={l.href} className={navLink} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/cart" className="btn btn-ghost px-3 py-2 text-sm" aria-label="Корзина">
            🛒 <span className="hidden sm:inline">Корзина</span>
          </Link>
          {user ? (
            <div className="relative">
              <button
                className="btn btn-ghost px-3 py-2 text-sm"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="menu"
              >
                {user.name ?? user.email.split("@")[0]} ▾
              </button>
              {open && (
                <div className="card absolute right-0 mt-2 w-52 overflow-hidden p-1 shadow-float" role="menu">
                  {USER_MENU.map(([href, label]) => (
                    <Link key={href} href={href} role="menuitem" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                      {label}
                    </Link>
                  ))}
                  {(user.role === "SELLER" || user.role === "ADMIN") && (
                    <Link href="/seller" role="menuitem" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                      Кабинет продавца
                    </Link>
                  )}
                  <button
                    role="menuitem"
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-bad hover:bg-surface-muted"
                    onClick={() => {
                      void fetch("/api/auth/logout", { method: "POST" }).then(() => location.assign("/"));
                    }}
                  >
                    Выйти
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost px-3 py-2 text-sm">
                Войти
              </Link>
              <Link href="/register" className="btn btn-primary hidden px-3 py-2 text-sm sm:inline-flex">
                Регистрация
              </Link>
            </>
          )}
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" className="border-t border-surface-line bg-white px-4 py-2 md:hidden" aria-label="Мобильная навигация">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-surface-muted">
              {l.label}
            </Link>
          ))}
          {!user && (
            <Link href="/register" className="btn btn-primary mb-1 mt-2 w-full justify-center">
              Регистрация
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
