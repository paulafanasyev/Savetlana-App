"use client";

import { useState, type FormEvent } from "react";
import type { Portfolio } from "@/lib/portfolio";
import { ITEMS_MAX, ITEM_TEXT_MAX, ITEM_TITLE_MAX, ABOUT_MAX, PORTFOLIO_PHOTO_MAX_BYTES } from "@/lib/portfolio";

const MAX_SIDE = 1600;

/** Уменьшает фото в браузере до 1600 px по длинной стороне (JPEG). */
async function shrinkPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Не удалось открыть «${file.name}». Сохраните фото как JPG или PNG`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не умеет обрабатывать фото");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error(`Не удалось сжать «${file.name}»`);
  if (blob.size > PORTFOLIO_PHOTO_MAX_BYTES) throw new Error("Фото получилось тяжелее 2 МБ, выберите другое");
  return blob;
}

async function call(method: string, url: string, body?: unknown): Promise<Portfolio> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { portfolio?: Portfolio; error?: string };
  if (!res.ok || !json.portfolio) throw new Error(json.error ?? "Не удалось сохранить");
  return json.portfolio;
}

export function PortfolioEditor({ initial, bucket }: { initial: Portfolio; bucket: string }) {
  const [p, setP] = useState<Portfolio>(initial);
  const [about, setAbout] = useState(initial.about);
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("profile");
    setMessage(null);
    try {
      const next = await call("PUT", "/api/portfolio", { about, skills });
      setP(next);
      setSkills(next.skills.join(", "));
      setMessage({ ok: true, text: "Сохранено" });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Не удалось сохранить" });
    } finally {
      setBusy(null);
    }
  }

  async function addWork(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("item");
    setMessage(null);
    try {
      let imageUrl: string | null = null;
      if (photo) {
        const blob = await shrinkPhoto(photo);
        const form = new FormData();
        form.set("bucket", bucket);
        form.set("storageClass", "public");
        form.append("file", blob, `${photo.name.replace(/\.[^.]+$/, "") || "work"}.jpg`);
        const res = await fetch("/api/storage/upload", { method: "POST", body: form });
        const json = (await res.json().catch(() => ({}))) as { results?: { ok: boolean; url?: string; reason?: string }[]; error?: string };
        const first = json.results?.[0];
        if (!res.ok || !first?.ok || !first.url) throw new Error(first?.reason ?? json.error ?? "Не удалось загрузить фото");
        imageUrl = first.url;
      }
      const next = await call("POST", "/api/portfolio", { title, description, imageUrl });
      setP(next);
      setTitle("");
      setDescription("");
      setPhoto(null);
      setMessage({ ok: true, text: "Работа добавлена" });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Не удалось добавить работу" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      setP(await call("DELETE", `/api/portfolio?id=${encodeURIComponent(id)}`));
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Не удалось убрать работу" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {message && <p className={`rounded-lg p-3 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      <form className="card space-y-3 p-5" onSubmit={saveProfile}>
        <h2 className="text-lg font-semibold">О себе и навыки</h2>
        <label className="block text-sm">
          О себе
          <textarea className="input mt-1 min-h-[100px] w-full" maxLength={ABOUT_MAX} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Чем занимаетесь, сколько лет опыта, как работаете с заказчиками" />
        </label>
        <label className="block text-sm">
          Навыки через запятую
          <input className="input mt-1 w-full" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Например: дизайн сайтов, Figma, вёрстка" />
        </label>
        <button className="btn btn-primary" disabled={busy !== null}>{busy === "profile" ? "Сохраняем…" : "Сохранить"}</button>
      </form>

      <form className="card space-y-3 p-5" onSubmit={addWork}>
        <h2 className="text-lg font-semibold">Добавить работу</h2>
        <label className="block text-sm">
          Название
          <input className="input mt-1 w-full" required minLength={3} maxLength={ITEM_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Лендинг для кофейни" />
        </label>
        <label className="block text-sm">
          Что сделали
          <textarea className="input mt-1 min-h-[80px] w-full" maxLength={ITEM_TEXT_MAX} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Задача, срок, результат" />
        </label>
        <label className="block text-sm">
          Фото работы
          <input className="mt-1 block text-sm" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn btn-primary" disabled={busy !== null || p.items.length >= ITEMS_MAX}>{busy === "item" ? "Добавляем…" : "Добавить работу"}</button>
        <p className="text-xs text-ink-faint">До {ITEMS_MAX} работ. Фото уменьшается перед отправкой.</p>
      </form>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Мои работы: {p.items.length}</h2>
        {p.items.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Пока пусто. Добавьте 2–3 лучшие работы: заказчики чаще выбирают исполнителей с примерами.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {p.items.map((i) => (
              <li key={i.id} className="rounded-lg border border-surface-line p-3">
                {i.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt={i.title} className="mb-2 aspect-video w-full rounded-md object-cover" />
                )}
                <p className="font-medium text-ink">{i.title}</p>
                {i.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{i.description}</p>}
                <button type="button" className="mt-2 text-xs text-bad hover:underline" disabled={busy !== null} onClick={() => void remove(i.id)}>
                  {busy === i.id ? "Убираем…" : "Убрать"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
