"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const KINDS: [string, string][] = [
  ["company_doc", "Документы компании (ИНН, ОГРН, устав)"],
  ["certificate", "Сертификат соответствия"],
  ["declaration", "Декларация соответствия"],
  ["license", "Лицензия"],
  ["product_doc", "Документ на товар"],
];
const MAX_BYTES = 10 * 1024 * 1024;

/** Загрузка документа продавца: PDF или фото, дальше документ проверяет человек. */
export function DocumentUploadForm({ suggestedKind }: { suggestedKind?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState(suggestedKind && KINDS.some(([k]) => k === suggestedKind) ? suggestedKind : "company_doc");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!file) return setError("Выберите файл");
    if (file.size > MAX_BYTES) return setError("Файл больше 10 МБ, сожмите его или загрузите по страницам");
    if (title.trim().length < 3) return setError("Назовите документ, например «Сертификат на чайники»");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("title", title.trim());
      form.set("file", file);
      const response = await fetch("/api/seller/documents", { method: "POST", body: form });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Не удалось загрузить документ");
      setMessage("Документ загружен и отправлен на проверку. Обычно это занимает 1–2 рабочих дня.");
      setTitle("");
      setFile(null);
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Не удалось загрузить документ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-3 p-5" onSubmit={submit}>
      <h2 className="text-lg font-semibold text-ink">Загрузить документ</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">Тип документа
          <select className="input mt-1 w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="block text-sm">Название
          <input className="input mt-1 w-full" value={title} maxLength={200} placeholder="Например, сертификат на чайники" onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">Файл (PDF, JPG, PNG или WebP, до 10 МБ)
        <input className="input mt-1 w-full" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <p className="text-xs text-ink-faint">Файл хранится закрыто, его видит только проверяющий площадки. Действительность документа проверяет человек.</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {message && <p className="text-sm text-green-700" role="status">{message}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Загружаю…" : "Загрузить"}</button>
    </form>
  );
}
