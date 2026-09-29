"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Header() {
  const [user, setUser] = useState<{ name?: string; email: string; role: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-surface-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-svetlana-600 font-bold text-white">
            Св
          </span>
          <span className="hidden text-lg font-bold text-ink sm:inline">Светлана</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          <Link className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink" href="/">
            Главная
          </Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink" href="/catalog">
            Каталог
          </Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink" href="/classifieds">
            Объявления
          </Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink" href="/svetlana">
            Светлана
          </Link>
          {user?.role === "SELLER" && (
            <Link className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink" href="/seller">
              Кабинет продавца
            </Link>
          )}
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
              >
                {user.name ?? user.email.split("@")[0]} ▾
              </button>
              {open && (
                <div className="card absolute right-0 mt-2 w-48 overflow-hidden p-1 shadow-float">
                  <Link href="/profile" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Мой профиль
                  </Link>
                  <Link href="/orders" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Мои заказы
                  </Link>
                  <Link href="/favorites" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Избранное
                  </Link>
                  <Link href="/gifts" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Подарки
                  </Link>
                  <Link href="/recommendations" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Рекомендации
                  </Link>
                  <Link href="/notifications" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Уведомления
                  </Link>
                  <Link href="/privacy" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                    Конфиденциальность
                  </Link>
                  {user.role === "SELLER" && (
                    <Link href="/seller" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
                      Кабинет продавца
                    </Link>
                  )}
                  <button
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
              <Link href="/register" className="btn btn-primary px-3 py-2 text-sm">
                Регистрация
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
