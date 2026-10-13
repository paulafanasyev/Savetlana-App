"use client";

import { useEffect, useState } from "react";

interface Status { loaded: boolean; products: number; sellers: number }

export function DemoCatalogPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/demo").then((r) => (r.ok ? r.json() : null)).then((d) => d && setStatus(d)).catch(() => undefined);
  }, []);

  async function run(action: "load" | "remove") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не получилось");
      setStatus(data);
      setMessage(action === "load" ? `Готово: ${data.products} демо-товаров в каталоге.` : "Демо-товары сняты с продажи.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-base font-bold text-ink">Демо-режим</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Наполняет каталог демо-товарами (кроссовки, электроника, дом, одежда, инструмент, услуги), чтобы проверить поиск, корзину и Светлану. Все товары помечены как демо, их продавцы ненастоящие, войти под ними нельзя.
      </p>
      <p className="mt-2 text-sm text-ink">
        {status ? (status.loaded ? `Сейчас в каталоге ${status.products} демо-товаров.` : "Демо-товаров нет.") : "Проверяю…"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => run("load")}>{status?.loaded ? "Обновить демо-товары" : "Загрузить демо-товары"}</button>
        {status?.loaded && <button className="btn btn-ghost" disabled={busy} onClick={() => run("remove")}>Убрать демо-товары</button>}
      </div>
      {message && <p className="mt-2 text-sm text-ink-soft" role="status">{message}</p>}
    </section>
  );
}
