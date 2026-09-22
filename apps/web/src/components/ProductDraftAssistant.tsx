"use client";

import { useState } from "react";

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface Draft {
  id: string;
  title: string;
  sku: string;
  priceKopecks: number;
  status: string;
  aiDraft: boolean;
}

/**
 * AI product creation (spec §12). The seller describes the item in natural
 * language; Svetlana prepares a DRAFT card. The draft is never published
 * automatically — the seller reviews it and confirms publication explicitly.
 */
export function ProductDraftAssistant({ categories }: { categories: Category[] }) {
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [keywords, setKeywords] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createDraft() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/seller/products/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceRub: price ? Number(price) : undefined,
          categorySlug: categorySlug || undefined,
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          imageUrl: imageUrl.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не удалось создать черновик");
      setDraft(json.draft);
      setMessage(
        "Светлана подготовила черновик карточки. Проверьте данные перед публикацией."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/seller/products/${draft.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Не удалось опубликовать товар");
      }
      setMessage(`Карточка «${draft.title}» опубликована и видна покупателям.`);
      setDraft(null);
      setTitle("");
      setDescription("");
      setPrice("");
      setKeywords("");
      setImageUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Создать карточку с помощью Светланы</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Опишите товар словами — Светлана подготовит черновик: название, описание,
          характеристики и ключевые слова. Публикация остаётся за вами.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Название товара *</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Беспроводные наушники"
            className="input w-full"
          />
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Описание товара *</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Что это, для чего, состояние, комплектация…"
            className="input w-full"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-faint">Цена, ₽</span>
          <input
            type="number"
            min={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input w-full"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-faint">Категория</span>
          <select
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
            className="input w-full"
          >
            <option value="">определить автоматически</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Ключевые слова (через запятую)</span>
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="наушники, беспроводные, bluetooth"
            className="input w-full"
          />
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Ссылка на фото</span>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
            className="input w-full"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && !error && <p className="text-sm text-green-700">{message}</p>}

      {!draft ? (
        <button
          type="button"
          onClick={createDraft}
          disabled={loading || !title.trim() || !description.trim()}
          className="btn btn-primary"
        >
          {loading ? "Светлана готовит черновик…" : "Подготовить черновик"}
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-svetlana-200 bg-svetlana-50 p-4">
          <div className="text-sm font-semibold text-ink">Черновик готов</div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-faint">SKU</dt>
            <dd className="font-mono text-xs text-ink-soft">{draft.sku}</dd>
            <dt className="text-ink-faint">Название</dt>
            <dd className="text-ink">{draft.title}</dd>
            <dt className="text-ink-faint">Цена</dt>
            <dd className="text-ink">{(draft.priceKopecks / 100).toFixed(0)} ₽</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={publish}
              disabled={publishing}
              className="btn btn-primary"
            >
              {publishing ? "Публикую…" : "Проверил — опубликовать"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="btn btn-ghost"
              formNoValidate
            >
              Отбросить черновик
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Публикация делает карточку видимой покупателям. Юридически значимые
            данные публикуются только после вашей проверки.
          </p>
        </div>
      )}
    </div>
  );
}
