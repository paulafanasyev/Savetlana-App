"use client";

import Link from "next/link";
import { useState } from "react";

interface Category { id: string; name: string; slug: string }
interface Draft { id: string; title: string; sku: string; priceKopecks: number; status: string; aiDraft: boolean }
interface UploadItem { ok: boolean; originalName?: string; reason?: string }

const MAX_PHOTOS = 8;
const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * afterPublishHref: куда перейти после публикации. Без него страница просто
 * обновляется (список товаров), со страницы «Новый товар» уходим в список.
 */
export function ProductDraftAssistant({ categories, afterPublishHref }: { categories: Category[]; afterPublishHref?: string }) {
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
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [rawText, setRawText] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeNote, setComposeNote] = useState<string | null>(null);

  function reset() {
    setDraft(null); setTitle(""); setDescription(""); setPrice(""); setKeywords(""); setCategorySlug(""); setFiles([]);
    setAttributes({}); setRawText(""); setComposeNote(null);
    setError(null); setWarning(null);
  }

  /** Светлана составляет карточку из текста продавца и заполняет поля ниже. */
  async function compose() {
    setComposing(true); setError(null); setComposeNote(null); setMessage(null);
    try {
      const response = await fetch("/api/seller/products/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.draft) throw new Error(json?.error ?? "Не получилось составить карточку");
      const d = json.draft as { title: string; description: string; priceRub?: number; categorySlug: string; keywords: string[]; attributes: Record<string, string> };
      setTitle(d.title);
      setDescription(d.description);
      setPrice(d.priceRub ? String(Math.round(d.priceRub)) : "");
      setCategorySlug(categories.some((c) => c.slug === d.categorySlug) ? d.categorySlug : "");
      setKeywords(d.keywords.join(", "));
      setAttributes(d.attributes ?? {});
      const missing = [
        !d.priceRub && "цену",
        !d.categorySlug && "категорию",
        "фотографии",
      ].filter(Boolean).join(", ");
      setComposeNote(
        (json.source === "model"
          ? "Светлана составила карточку из вашего текста. Проверьте каждое поле."
          : "Светлана разложила ваш текст по полям. Проверьте и при необходимости допишите описание.") +
          ` Добавьте ${missing}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось составить карточку");
    } finally {
      setComposing(false);
    }
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
          attributes: Object.keys(attributes).length ? attributes : undefined,
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
      if (afterPublishHref) window.location.assign(afterPublishHref);
      else window.location.reload();
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
      {!draft && (
        <div className="space-y-2 rounded-lg border border-svetlana-200 bg-svetlana-50 p-4">
          <p className="text-sm font-semibold text-ink">Светлана составит карточку сама</p>
          <p className="text-xs text-ink-faint">
            Напишите о товаре своими словами, как другу: что это, бренд и модель, размер, цвет, состояние, цена.
            Например: «Кроссовки Nike Air Max 90, белые, 42 размер, новые, 7990 ₽». Светлана берёт сведения только из вашего текста.
          </p>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={3}
            maxLength={2000}
            className="input w-full"
            aria-label="Товар своими словами"
          />
          <button type="button" onClick={compose} disabled={composing || rawText.trim().length < 5} className="btn btn-primary">
            {composing ? "Светлана составляет…" : "Составить карточку"}
          </button>
          {composeNote && <p className="text-xs text-green-800" role="status">{composeNote}</p>}
        </div>
      )}
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
        {Object.keys(attributes).length > 0 && (
          <div className="md:col-span-2">
            <span className="mb-1 block text-xs text-ink-faint">Характеристики из вашего текста</span>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(attributes).map(([key, value]) => (
                <li key={key} className="chip flex items-center gap-1 text-xs">
                  {key}: {value}
                  {!draft && (
                    <button
                      type="button"
                      aria-label={`Убрать «${key}»`}
                      className="ml-1 text-ink-faint hover:text-ink"
                      onClick={() => setAttributes(Object.fromEntries(Object.entries(attributes).filter(([k]) => k !== key)))}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
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
            <dt className="text-ink-faint">Цена</dt><dd>{draft.priceKopecks > 0 ? `${(draft.priceKopecks / 100).toFixed(0)} ₽` : "не указана, добавьте перед публикацией"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={publish} disabled={publishing} className="btn btn-primary">
              {publishing ? "Публикую…" : "Проверил, опубликовать"}
            </button>
            <Link href={`/seller/products/${draft.id}/edit`} className="btn btn-ghost">Остаток, фото и характеристики</Link>
            <button type="button" onClick={reset} disabled={publishing} className="btn btn-ghost">Создать другой товар</button>
          </div>
          <p className="text-xs text-ink-faint">Черновик сохранён в разделе «Товары», его можно опубликовать позже.</p>
        </div>
      )}
    </div>
  );
}
