"use client";

import { useState } from "react";
import { rub } from "@/lib/format";

interface Position {
  ownPriceKopecks: number;
  marketMin: number | null;
  marketMax: number | null;
  marketMedian: number | null;
  competitorCount: number;
  position: "below_market" | "at_market" | "above_market" | "no_data";
  percentile: number | null;
}
interface Advice {
  productId: string;
  title: string;
  position: Position;
  direction: "lower" | "raise" | "hold";
  reasoning: string[];
  suggestedPriceKopecks: number | null;
  confidence: number;
  requiresConfirmation: boolean;
}
interface HistoryPoint {
  priceKopecks: number;
  changedAt: string;
}
interface PricingData {
  position: Position;
  advice: Advice;
  history: HistoryPoint[];
}

const POSITION_LABEL: Record<string, string> = {
  below_market: "Ниже рынка",
  at_market: "В рынке",
  above_market: "Выше рынка",
  no_data: "Нет данных",
};
const DIRECTION_LABEL: Record<string, string> = {
  lower: "Снизить",
  raise: "Поднять",
  hold: "Держать",
};

/**
 * Pricing & competitor intelligence (spec §19, §54). A price change is a
 * substantial commercial action: Svetlana advises, the seller confirms.
 */
export function PricingPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/seller/pricing?productId=${productId}`);
      if (!res.ok) throw new Error("Не удалось получить данные по цене");
      const json = await res.json();
      setData(json);
      setNewPrice((json.advice.suggestedPriceKopecks / 100).toFixed(0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/seller/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          newPriceRubles: Number(newPrice),
          confirm: true,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Не удалось изменить цену");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setSaving(false);
    }
  }

  if (!data && !loading) {
    return (
      <button type="button" onClick={load} className="btn btn-ghost text-sm">
        Анализ цены и конкурентов
      </button>
    );
  }
  if (loading) return <p className="text-sm text-ink-faint">Светлана анализирует цены…</p>;
  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;

  const { position, advice, history } = data;

  return (
    <div className="card mt-3 space-y-4 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <span className="chip">{POSITION_LABEL[position.position]}</span>
        <span className="chip bg-svetlana-50 text-svetlana-700">
          Совет: {DIRECTION_LABEL[advice.direction]}
        </span>
        {position.percentile !== null && (
          <span className="chip bg-surface-muted text-ink-soft">
            перцентиль {position.percentile}%
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-ink-faint">Ваша цена</div>
          <div className="font-semibold text-ink">{rub(position.ownPriceKopecks)}</div>
        </div>
        {position.marketMin !== null && (
          <>
            <div>
              <div className="text-xs text-ink-faint">Минимум рынка</div>
              <div className="font-medium text-ink">{rub(position.marketMin)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-faint">Медиана рынка</div>
              <div className="font-medium text-ink">{rub(position.marketMedian)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-faint">Максимум рынка</div>
              <div className="font-medium text-ink">{rub(position.marketMax)}</div>
            </div>
          </>
        )}
      </div>

      {advice.reasoning.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-ink">Почему Светлана это рекомендует</div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-soft">
            {advice.reasoning.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-ink">История изменения цены</div>
          <ul className="space-y-0.5 text-xs text-ink-faint">
            {history.slice(0, 6).map((point) => (
              <li key={point.changedAt} className="flex justify-between">
                <span>{rub(point.priceKopecks)}</span>
                <span>{new Date(point.changedAt).toLocaleDateString("ru-RU")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-surface-line pt-3">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-ink-faint">Новая цена, ₽</span>
          <input
            type="number"
            min={1}
            step="1"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="input w-full"
          />
        </label>
        <button
          type="button"
          onClick={apply}
          disabled={saving || !newPrice || Number(newPrice) <= 0}
          className="btn btn-primary"
        >
          {saving ? "Сохраняю…" : "Применить цену"}
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        Изменение цены применяется только после вашего подтверждения.
      </p>
    </div>
  );
}
