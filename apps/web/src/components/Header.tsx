"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AikoLogo } from "@/components/AikoLogo";
import { badgeText, totalUnread, type UnreadCounts } from "@/lib/unread";
import { buyerTodoCount, parseBuyerTodoItems } from "@/lib/buyer-todo";

const PRIMARY = [
  { href: "/", label: "Главная" },
  { href: "/catalog", label: "Каталог" },
  { href: "/classifieds", label: "Объявления" },
  { href: "/freelance", label: "Фриланс" },
  { href: "/svetlana", label: "Светлана" },
];

const USER_MENU: [string, string][] = [
  ["/profile", "Мой профиль"],
  ["/profile/portfolio", "Портфолио"],
  ["/promote", "Продвижение"],
  ["/orders", "Мои заказы"],
  ["/messages", "Сообщения"],
  ["/disputes", "Возвраты и споры"],
  ["/favorites", "Избранное"],
  ["/gifts", "Подарки"],
  ["/recommendations", "Рекомендации"],
  ["/notifications", "Уведомления"],
  ["/privacy", "Конфиденциальность"],
];

const TODO_REFRESH_MS = 60_000;

/** Сколько дел по заказам ждут покупателя. null: не удалось узнать. */
async function loadTodoCount(): Promise<number | null> {
  try {
    const r = await fetch("/api/orders/todo", { cache: "no-store" });
    if (!r.ok) return null;
    const items = parseBuyerTodoItems(await r.json());
    return items ? buyerTodoCount(items) : null;
  } catch {
    return null;
  }
}

/** Кружок с числом: красный для непрочитанного, янтарный для дел по заказам. Пусто, если 0. */
function Badge({ n, label, tone = "red" }: { n: number; label: string; tone?: "red" | "amber" }) {
  const text = badgeText(n);
  if (!text) return null;
  const color = tone === "amber" ? "bg-amber-500" : "bg-red-600";
  return (
    <span className={`ml-1 inline-flex min-w-5 items-center justify-center rounded-full ${color} px-1.5 text-[11px] font-semibold leading-5 text-white`} aria-label={`${label}: ${text}`}>
      {text}
    </span>
  );
}

const navLink = "rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink";

export function Header() {
  const [user, setUser] = useState<{ name?: string; email: string; role: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState<UnreadCounts | null>(null);
  const [todo, setTodo] = useState(0);
  const pathname = usePathname();
  const signedIn = user !== null;

  // Перечитываем при каждом переходе: прочитал сообщения, и цифра в шапке сразу уменьшилась.
  // Дела по заказам спрашиваем только у вошедшего: оплатил заказ, и значок пропал.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then(async (d) => {
        if (cancelled) return;
        setUser(d.user ?? null);
        setUnread(d.unread ?? null);
        if (!d.user) return setTodo(0);
        const n = await loadTodoCount();
        if (!cancelled) setTodo(n ?? 0);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Сидит на одной странице: раз в минуту и при возвращении на вкладку пересчитываем дела.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadTodoCount().then((n) => {
        if (!cancelled && n !== null) setTodo(n);
      });
    };
    const timer = window.setInterval(refresh, TODO_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedIn]);

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
                {user.name ?? user.email.split("@")[0]}
                <Badge n={totalUnread(unread)} label="Новых" />
                <Badge n={todo} label="Дел по заказам" tone="amber" /> ▾
              </button>
              {open && (
                <div className="card absolute right-0 mt-2 w-52 overflow-hidden p-1 shadow-float" role="menu">
                  {USER_MENU.map(([href, label]) => (
                    <Link key={href} href={href} role="menuitem" className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                      {label}
                      {href === "/orders" && <Badge n={todo} label="Дел по заказам" tone="amber" />}
                      {href === "/messages" && <Badge n={unread?.messages ?? 0} label="Новых сообщений" />}
                      {href === "/notifications" && <Badge n={unread?.other ?? 0} label="Новых уведомлений" />}
                    </Link>
                  ))}
                  {(user.role === "SELLER" || user.role === "ADMIN") && (
                    <Link href={(unread?.sellerMessages ?? 0) > 0 ? "/seller/messages" : "/seller"} role="menuitem" className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                      Кабинет продавца
                      <Badge n={unread?.sellerMessages ?? 0} label="Новых сообщений от покупателей" />
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
          {user && (
            <Link href="/orders" className="flex items-center rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-surface-muted">
              Мои заказы
              <Badge n={todo} label="Дел по заказам" tone="amber" />
            </Link>
          )}
          {user && (
            <Link href="/promote" className="block rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-surface-muted">
              Продвижение
            </Link>
          )}
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
