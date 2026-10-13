"use client";

import Link from "next/link";
import { useState } from "react";

interface Category { id: string; name: string; slug: string }
interface Draft { id: string; title: string; sku: string; priceKopecks: number; status: string; aiDraft: boolean }
interface UploadItem { ok: boolean; originalName?: string; reason?: string }

const MAX_PHOTOS = 8;
const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ProductDraftAssistant({ categories }: { categories: Category[] }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [keywords, setKeywords] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setDraft(null); setTitle(""); setDescription(""); setPrice(""); setKeywords(""); setCategorySlug(""); setFiles([]);
    setError(null); setWarning(null);
  }

  function chooseFiles(list: FileList | null) {
    const selected = Array.from(list ?? []);
    if (selected.length > MAX_PHOTOS) { setError(`Можно добавить не больше ${MAX_PHOTOS} фотографий`); return; }
    const invalid = selected.find((file) => file.size > MAX_BYTES || !IMAGE_TYPES.includes(file.type));
    if (invalid) { setError(`Файл «${invalid.name}»: нужен JPG, PNG или WebP не больше 2 МБ`); return; }
    setFiles(selected);
    setError(null);
  }

  /** Возвращает список файлов, которые не загрузились. Черновик при этом сохраняется. */
  async function uploadPhotos(productId: string): Promise<string[]> {
    if (!files.length) return [];
    const form = new FormData();
    form.set("bucket", `public/products/${productId}`);
    form.set("storageClass", "public");
    form.set("productId", productId);
    files.forEach((file) => form.append("file", file));
    try {
      const response = await fetch("/api/storage/upload", { method: "POST", body: form });
      const json = (await response.json().catch(() => ({}))) as { results?: UploadItem[]; error?: string };
      const results = json.results ?? [];
      if (!results.length) return files.map((file) => `${file.name} (${json.error ?? "ошибка загрузки"})`);
      return results.filter((item) => !item.ok).map((item) => `${item.originalName ?? "файл"} (${item.reason ?? "отклонён"})`);
    } catch {
      return files.map((file) => `${file.name} (нет связи)`);
    }
  }

  async function createDraft() {
    setLoading(true); setError(null); setWarning(null); setMessage(null);
    try {
      const response = await fetch("/api/seller/products/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceRub: price ? Number(price) : undefined,
          categorySlug: categorySlug || undefined,
          keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Не удалось создать черновик");
      const raw = json.draft as Draft & { productId?: string };
      const productId = raw?.id ?? raw?.productId;
      if (!productId) throw new Error("Сервер не вернул товар");
      // Черновик показываем сразу: даже если фото не загрузятся, товар не потеряется.
      setDraft({ ...raw, id: productId });
      const failed = await uploadPhotos(productId);
      if (failed.length) setWarning(`Не загрузились фото: ${failed.join(", ")}. Добавьте их на странице редактирования.`);
      setMessage("Черновик готов. Проверьте карточку перед публикацией.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true); setError(null);
    try {
      const response = await fetch(`/api/seller/products/${draft.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Не удалось опубликовать товар");
      }
      const name = draft.title;
      reset();
      setMessage(`Карточка «${name}» опубликована.`);
      window.location.reload();
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
          Опишите товар и добавьте до восьми фотографий. Первая фотография станет главной.
          Перед публикацией проверьте карточку: за её содержание отвечает продавец.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Название товара *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="input w-full" disabled={Boolean(draft)} />
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Описание товара *</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} className="input w-full" disabled={Boolean(draft)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-faint">Цена, ₽</span>
          <input type="number" min={1} step="1" value={price} onChange={(e) => setPrice(e.target.value)} className="input w-full" disabled={Boolean(draft)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-faint">Категория</span>
          <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="input w-full" disabled={Boolean(draft)}>
            <option value="">Выберите категорию</option>
            {categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Ключевые слова через запятую</span>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input w-full" disabled={Boolean(draft)} />
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-ink-faint">Фотографии (до 8, первая главная)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => chooseFiles(e.target.files)} className="input w-full" disabled={Boolean(draft)} />
          <span className="mt-1 block text-xs text-ink-faint">JPG, PNG или WebP, до 2 МБ каждая.</span>
        </label>
      </div>
      {files.length > 0 && !draft && <p className="text-sm text-ink-faint">Выбрано фотографий: {files.length}</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {warning && <p className="text-sm text-amber-700" role="status">{warning}</p>}
      {message && !error && <p className="text-sm text-green-700" role="status">{message}</p>}
      {!draft ? (
        <button
          type="button"
          onClick={createDraft}
          disabled={loading || title.trim().length < 2 || !description.trim() || (price !== "" && Number(price) < 1)}
          className="btn btn-primary"
        >
          {loading ? "Светлана готовит черновик…" : "Подготовить черновик"}
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-svetlana-200 bg-svetlana-50 p-4">
          <div className="text-sm font-semibold text-ink">Черновик готов</div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-faint">Код товара</dt><dd className="font-mono text-xs text-ink-soft">{draft.sku}</dd>
            <dt className="text-ink-faint">Название</dt><dd>{draft.title}</dd>
            <dt className="text-ink-faint">Цена</dt><dd>{(draft.priceKopecks / 100).toFixed(0)} ₽</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={publish} disabled={publishing} className="btn btn-primary">
              {publishing ? "Публикую…" : "Проверил, опубликовать"}
            </button>
            <Link href={`/seller/products/${draft.id}/edit`} className="btn btn-ghost">Остаток, фото и характеристики</Link>
            <button type="button" onClick={reset} disabled={publishing} className="btn btn-ghost">Создать другой товар</button>
          </div>
          <p className="text-xs text-ink-faint">Черновик сохранён в списке товаров ниже, его можно опубликовать позже.</p>
        </div>
      )}
    </div>
  );
}
