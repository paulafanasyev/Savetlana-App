"use client";

import Link from "next/link";
import { useState } from "react";

interface DraftCheck {
  productId: string;
  title: string;
  problems: string[];
}

interface Props {
  drafts: number;
  ready: DraftCheck[];
  blocked: DraftCheck[];
  more: boolean;
  gateReason: string | null;
}

function goodsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "товар";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "товара";
  return "товаров";
}

/** Публикует разом все черновики, у которых есть цена, фото и остаток. */
export function PublishAllDrafts({ drafts, ready, blocked, more, gateReason }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);

  if (drafts === 0) return null;

  async function publish() {
    const n = ready.length;
    if (!window.confirm(`Опубликовать ${n} ${goodsWord(n)}? Покупатели сразу увидят их в каталоге.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/seller/products/publish-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, confirm: true, productIds: ready.map((item) => item.productId) }),
      });
      const data = (await res.json().catch(() => null)) as { published?: number; skipped?: DraftCheck[]; error?: string; message?: string } | null;
      if (!res.ok || !data || typeof data.published !== "number") {
        setError(data?.error ?? data?.message ?? "Не удалось опубликовать. Попробуйте ещё раз через минуту.");
        return;
      }
      const skipped = data.skipped?.length ?? 0;
      setMessage(
        `Опубликовано: ${data.published} ${goodsWord(data.published)}.` +
          (skipped ? ` Пропущено: ${skipped} (что-то изменилось с момента проверки).` : "")
      );
      window.setTimeout(() => window.location.reload(), 1500);
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="publish-all-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="publish-all-title" className="text-base font-semibold">Черновики: {drafts}</h2>
          <p className="text-sm text-ink-soft">
            Готовы к публикации: {ready.length}
            {blocked.length > 0 && <>, ещё {blocked.length} ждут доработки</>}
            {more && <>. Показаны последние {ready.length + blocked.length}, остальные после следующего захода</>}.
          </p>
        </div>
        {gateReason === null && ready.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={publish} disabled={busy}>
            {busy ? "Публикую…" : `Опубликовать все готовые (${ready.length})`}
          </button>
        )}
      </div>
      {gateReason && <p className="rounded-lg bg-surface-muted p-3 text-sm text-ink-soft">{gateReason}</p>}
      {message && <p className="text-sm font-medium text-svetlana-700" role="status">{message}</p>}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      {blocked.length > 0 && (
        <div className="text-sm">
          <button type="button" className="font-medium text-svetlana-700 hover:underline" onClick={() => setShowBlocked((v) => !v)} aria-expanded={showBlocked}>
            {showBlocked ? "Скрыть, чего не хватает" : `Чего не хватает остальным (${blocked.length})`}
          </button>
          {showBlocked && (
            <ul className="mt-2 space-y-1">
              {blocked.slice(0, 50).map((item) => (
                <li key={item.productId}>
                  <Link href={`/seller/products/${item.productId}/edit`} className="font-medium text-ink hover:text-svetlana-700">{item.title}</Link>
                  <span className="text-ink-faint">: {item.problems.join(", ")}</span>
                </li>
              ))}
              {blocked.length > 50 && <li className="text-ink-faint">и ещё {blocked.length - 50}</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
