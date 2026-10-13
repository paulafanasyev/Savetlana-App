"use client";

import { useState } from "react";

interface Product {
  id: string;
  title: string;
  description: string | null;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  status: string;
  attributes: string;
  categoryId: string | null;
  inventory: { quantity: number } | null;
  images: { url: string }[];
}
interface Category { id: string; name: string; slug: string }

function prettyAttributes(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw || "{}"), null, 2); } catch { return "{}"; }
}

export function ProductEditor({ product, categories }: { product: Product; categories: Category[] }) {
  const [form, setForm] = useState({
    title: product.title,
    description: product.description ?? "",
    price: String(product.priceKopecks / 100),
    oldPrice: product.oldPriceKopecks == null ? "" : String(product.oldPriceKopecks / 100),
    stock: String(product.inventory?.quantity ?? 0),
    categoryId: product.categoryId ?? "",
    attributes: prettyAttributes(product.attributes),
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      let attributes: Record<string, unknown>;
      try { attributes = JSON.parse(form.attributes || "{}"); } catch { throw new Error("Характеристики: проверьте формат, например {\"Цвет\": \"синий\"}"); }
      const price = Number(form.price);
      if (!Number.isFinite(price) || price < 1) throw new Error("Укажите цену от 1 ₽");
      const stock = Number(form.stock);
      if (!Number.isInteger(stock) || stock < 0) throw new Error("Остаток: целое число от 0");
      const category = categories.find((item) => item.id === form.categoryId);
      const response = await fetch(`/api/seller/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title, description: form.description, priceRub: price, oldPriceRub: form.oldPrice ? Number(form.oldPrice) : null, stockQuantity: stock, categorySlug: category?.slug ?? null, attributes }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Не удалось сохранить карточку");
      if (files.length) {
        const upload = new FormData();
        upload.set("bucket", `public/products/${product.id}`);
        upload.set("storageClass", "public");
        upload.set("productId", product.id);
        upload.set("replace", "true");
        files.forEach((file) => upload.append("file", file));
        const uploadResponse = await fetch("/api/storage/upload", { method: "POST", body: upload });
        const uploadJson = (await uploadResponse.json().catch(() => ({}))) as { results?: { ok: boolean; originalName?: string; reason?: string }[] };
        const failed = (uploadJson.results ?? []).filter((item) => !item.ok);
        if (!uploadResponse.ok) throw new Error("Карточка сохранена, но фотографии загрузить не удалось");
        if (failed.length) setError(`Не загрузились: ${failed.map((item) => `${item.originalName ?? "файл"} (${item.reason ?? "отклонён"})`).join(", ")}`);
      }
      setMessage("Изменения сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  async function togglePublication() {
    setBusy(true); setError("");
    try {
      const active = product.status === "ACTIVE";
      const response = await fetch(active ? `/api/seller/products/${product.id}/unpublish` : `/api/seller/products/${product.id}`, {
        method: active ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: active ? "{}" : JSON.stringify({ publish: true }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Не удалось изменить публикацию");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      {product.images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {product.images.map((image, index) => <img key={image.url} src={image.url} alt={index === 0 ? "Главное фото" : `Фото ${index + 1}`} className="h-20 w-20 rounded object-cover" />)}
        </div>
      )}
      <label className="block"><span className="mb-1 block text-sm">Название</span><input className="input w-full" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label className="block"><span className="mb-1 block text-sm">Описание</span><textarea className="input w-full" rows={6} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label><span className="mb-1 block text-sm">Цена, ₽</span><input className="input w-full" type="number" min="1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
        <label><span className="mb-1 block text-sm">Старая цена, ₽</span><input className="input w-full" type="number" min="0" value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: e.target.value })} /></label>
        <label><span className="mb-1 block text-sm">Остаток, шт.</span><input className="input w-full" type="number" min="0" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
      </div>
      <label className="block"><span className="mb-1 block text-sm">Категория</span>
        <select className="input w-full" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          <option value="">Без категории</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label className="block"><span className="mb-1 block text-sm">Характеристики (например {"{\"Цвет\": \"синий\"}"})</span><textarea className="input w-full font-mono text-sm" rows={6} value={form.attributes} onChange={(e) => setForm({ ...form, attributes: e.target.value })} /></label>
      <label className="block"><span className="mb-1 block text-sm">Заменить фотографии (до 8, JPG/PNG/WebP до 2 МБ)</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 8))} className="input w-full" /></label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {message && <p className="text-sm text-green-700" role="status">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>{busy ? "Сохраняю…" : "Сохранить"}</button>
        <button className="btn btn-ghost" type="button" onClick={togglePublication} disabled={busy}>{product.status === "ACTIVE" ? "Снять с продажи" : "Опубликовать товар"}</button>
      </div>
    </div>
  );
}
