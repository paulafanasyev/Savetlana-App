"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { rub } from "@/lib/format";

interface CartData {
  totalKopecks: number;
  totalUnits: number;
  sellerCount: number;
  lines: Array<{
    id: string;
    productId: string;
    title: string;
    quantity: number;
    priceKopecks: number;
    available: boolean;
    sellerName: string;
  }>;
}

export default function CartPage() {
  const [cart, setCart] = useState<CartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    fetch("/api/cart")
      .then((r) => (r.status === 401 ? null : r.json()))
      .then((d) => { setCart(d ?? null); setLoaded(true); })
      .catch(() => setError("Не удалось загрузить корзину"));

  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <p className="text-ink-soft">{error}</p>
          <button className="btn btn-ghost mt-4" onClick={() => load()}>Повторить</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card animate-pulse p-8 text-center text-ink-soft">Загружаем корзину…</div>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-ink">Корзина</h1>
          <p className="mt-2 text-ink-soft">Чтобы пользоваться корзиной, нужно войти в аккаунт.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/login?next=%2Fcart" className="btn btn-primary">Войти</Link>
            <Link href="/register" className="btn btn-ghost">Зарегистрироваться</Link>
          </div>
        </div>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-ink">Корзина пуста</h1>
          <p className="mt-2 text-ink-soft">Загляните в каталог или спросите Светлану: она поможет найти нужное.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/catalog" className="btn btn-primary">В каталог</Link>
            <Link href="/svetlana" className="btn btn-ghost">К Светлане</Link>
          </div>
        </div>
      </div>
    );
  }

  const unavailable = cart.lines.filter((l) => !l.available);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Корзина</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {cart.sellerCount > 1 && (
            <div className="card bg-svetlana-50 p-3 text-sm text-svetlana-700">
              Заказ будет разделён на {cart.sellerCount} заказа, по одному на каждого продавца.
            </div>
          )}
          {unavailable.length > 0 && (
            <div className="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
              Некоторых товаров нет в нужном количестве (отмечены ниже). Уменьшите количество или удалите их, чтобы оформить заказ.
            </div>
          )}
          {cart.lines.map((line) => (
            <div key={line.id} className={`card flex items-center gap-4 p-4${line.available ? "" : " border-amber-300"}`}>
              <div className="min-w-0 flex-1">
                <Link href={`/product/${line.productId}`} className="line-clamp-2 text-sm font-medium text-ink hover:text-svetlana-700">
                  {line.title}
                </Link>
                <div className="mt-1 text-xs text-ink-soft">{line.sellerName}</div>
                <div className="mt-1 text-sm font-bold text-svetlana-700">{rub(line.priceKopecks)}</div>
                {!line.available && <div className="mt-1 text-xs font-medium text-amber-700">Нет в нужном количестве</div>}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost h-8 w-8 px-0" aria-label="Уменьшить" onClick={() => update(line.id, line.quantity - 1)}>−</button>
                <span className="w-8 text-center text-sm font-medium">{line.quantity}</span>
                <button className="btn btn-ghost h-8 w-8 px-0" aria-label="Увеличить" onClick={() => update(line.id, line.quantity + 1)}>+</button>
                <button className="btn btn-ghost h-8 px-2 text-xs text-bad" onClick={() => update(line.id, 0)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
        <div className="card h-fit space-y-3 p-5 lg:sticky lg:top-20">
          <div className="flex justify-between text-sm text-ink-soft">
            <span>Товаров</span>
            <span className="font-medium text-ink">{cart.totalUnits}</span>
          </div>
          <div className="flex justify-between text-sm text-ink-soft">
            <span>Продавцов</span>
            <span className="font-medium text-ink">{cart.sellerCount}</span>
          </div>
          <div className="border-t border-surface-line pt-3">
            <div className="flex justify-between text-lg">
              <span className="font-medium text-ink">Итого</span>
              <span className="font-bold text-svetlana-700">{rub(cart.totalKopecks)}</span>
            </div>
            <div className="mt-1 text-xs text-ink-faint">Доставка выбирается на следующем шаге.</div>
          </div>
          {unavailable.length > 0 ? (
            <button className="btn btn-primary w-full" disabled>Сначала исправьте корзину</button>
          ) : (
            <Link href="/checkout" className="btn btn-primary w-full">Оформить заказ</Link>
          )}
        </div>
      </div>
    </div>
  );

  async function update(lineId: string, quantity: number) {
    await fetch(`/api/cart/items/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    void load();
  }
}
