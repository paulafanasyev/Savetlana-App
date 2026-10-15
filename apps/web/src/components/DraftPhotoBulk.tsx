"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MAX_PHOTOS_PER_PRODUCT, bestDraft, planPhotoUpload, type DraftForPhotos } from "@/lib/domains/photo-match";

const MAX_FILES = 200;
const MAX_BYTES = 2 * 1024 * 1024;

interface Picked {
  key: string;
  file: File;
  url: string;
}

interface Outcome {
  productId: string;
  saved: number;
  failed: string[];
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Продавец выбирает сразу много фото, Светлана раскладывает их по черновикам по именам файлов. */
export function DraftPhotoBulk({ drafts }: { drafts: DraftForPhotos[] }) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.url)), [picked]);

  const titles = useMemo(() => new Map(drafts.map((d) => [d.id, d.title])), [drafts]);
  const plan = useMemo(() => planPhotoUpload(assignment, drafts), [assignment, drafts]);
  const assigned = plan.groups.reduce((sum, g) => sum + g.files.length, 0);
  const withoutPhotos = drafts.filter((d) => d.photos === 0).length;

  function choose(list: FileList | null) {
    setOutcomes(null);
    setError("");
    const all = Array.from(list ?? []);
    const images = all.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    const tooBig = images.filter((f) => f.size > MAX_BYTES);
    const ok = images.filter((f) => f.size <= MAX_BYTES).slice(0, MAX_FILES);
    const next = ok.map((file, i) => ({ key: `${file.name}#${i}`, file, url: URL.createObjectURL(file) }));
    setPicked(next);
    setAssignment(Object.fromEntries(next.map((p) => [p.key, bestDraft(p.file.name, drafts)])));
    const notes: string[] = [];
    if (all.length > images.length) notes.push(`пропущено не-фото: ${all.length - images.length} (подходят JPG, PNG, WebP)`);
    if (tooBig.length) notes.push(`больше 2 МБ: ${tooBig.map((f) => f.name).slice(0, 5).join(", ")}${tooBig.length > 5 ? " и др." : ""}`);
    if (images.length - tooBig.length > MAX_FILES) notes.push(`за раз берём первые ${MAX_FILES} фото`);
    if (notes.length) setError(`Не взяла: ${notes.join("; ")}.`);
  }

  async function upload() {
    if (plan.groups.length === 0) return;
    setBusy(true);
    setError("");
    const byKey = new Map(picked.map((p) => [p.key, p.file]));
    const results: Outcome[] = [];
    try {
      for (let index = 0; index < plan.groups.length; index++) {
        const group = plan.groups[index];
        setProgress(`Загружаю ${index + 1} из ${plan.groups.length}: «${titles.get(group.productId) ?? ""}»`);
        const form = new FormData();
        form.set("bucket", `public/products/${group.productId}`);
        form.set("storageClass", "public");
        form.set("productId", group.productId);
        form.set("replace", "false");
        group.files.forEach((key) => {
          const file = byKey.get(key);
          if (file) form.append("file", file);
        });
        let response: Response | null = null;
        // Загрузок не больше 20 в минуту: при ответе «слишком часто» ждём и пробуем ещё.
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch("/api/storage/upload", { method: "POST", body: form });
          if (response.status !== 429) break;
          setProgress(`Сервер просит подождать, продолжу через 30 секунд (${index + 1} из ${plan.groups.length})`);
          await sleep(30_000);
        }
        const json = ((await response?.json().catch(() => null)) ?? {}) as { results?: { ok: boolean; originalName?: string; reason?: string }[]; error?: string };
        const list = json.results ?? [];
        results.push({
          productId: group.productId,
          saved: list.filter((r) => r.ok).length,
          failed: list.length
            ? list.filter((r) => !r.ok).map((r) => `${r.originalName ?? "файл"} (${r.reason ?? "отклонён"})`)
            : [json.error ?? "не удалось загрузить"],
        });
        setOutcomes([...results]);
      }
    } catch {
      setError("Связь прервалась. То, что уже загружено, сохранилось: обновите страницу и добавьте остальное.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  if (drafts.length === 0) {
    return <p className="card p-5 text-sm text-ink-soft">Черновиков нет. Создайте карточки (например, списком на странице «Добавить товар»), и здесь можно будет добавить к ним фото разом.</p>;
  }

  const savedTotal = outcomes?.reduce((sum, o) => sum + o.saved, 0) ?? 0;
  const failedTotal = outcomes?.reduce((sum, o) => sum + o.failed.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-5">
        <p className="text-sm text-ink-soft">
          Черновиков: {drafts.length}, без фото: {withoutPhotos}. Выберите сразу все фото. Светлана разложит их по карточкам по имени файла
          (например, «кроссовки-nike-1.jpg» или с кодом товара в имени), остальные выберите сами. Первое фото по имени станет главным, к карточке
          не больше {MAX_PHOTOS_PER_PRODUCT} фото. Фото добавляются к уже загруженным.
        </p>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="input w-full" disabled={busy} onChange={(e) => choose(e.target.files)} />
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      </section>

      {picked.length > 0 && (
        <section className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Фото: {picked.length}. Разложено по карточкам: <b>{assigned}</b>
              {plan.overflow.length > 0 && <>, не поместятся (больше {MAX_PHOTOS_PER_PRODUCT} на карточку): {plan.overflow.length}</>}.
            </p>
            <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || plan.groups.length === 0}>
              {busy ? "Загружаю…" : `Загрузить в ${plan.groups.length} ${plan.groups.length === 1 ? "карточку" : "карточек"}`}
            </button>
          </div>
          {progress && <p className="text-sm text-ink-soft" role="status">{progress}</p>}
          <ul className="divide-y">
            {picked.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-3 py-2">
                <img src={p.url} alt="" className="h-14 w-14 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate text-sm" title={p.file.name}>{p.file.name}</span>
                <select
                  className="input w-full md:w-80"
                  value={assignment[p.key] ?? ""}
                  disabled={busy}
                  aria-label={`Карточка для ${p.file.name}`}
                  onChange={(e) => setAssignment({ ...assignment, [p.key]: e.target.value || null })}
                >
                  <option value="">Не загружать</option>
                  {drafts.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}{d.photos ? ` (фото: ${d.photos})` : ""}</option>
                  ))}
                </select>
                {plan.overflow.includes(p.key) && <span className="text-xs text-bad">не поместится</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {outcomes && (
        <section className="card space-y-2 p-5 text-sm" role="status">
          <p className="font-medium">Загружено фото: {savedTotal}{failedTotal ? `, не загрузилось: ${failedTotal}` : ""}.</p>
          <ul className="space-y-1">
            {outcomes.map((o) => (
              <li key={o.productId}>
                <Link href={`/seller/products/${o.productId}/edit`} className="font-medium hover:text-svetlana-700">{titles.get(o.productId)}</Link>
                <span className="text-ink-soft">: добавлено {o.saved}</span>
                {o.failed.length > 0 && <span className="text-bad">. Не загрузилось: {o.failed.join(", ")}</span>}
              </li>
            ))}
          </ul>
          {!busy && <p><Link href="/seller/products" className="font-medium text-svetlana-700 hover:underline">К товарам</Link>: там черновики с фото, ценой и остатком можно опубликовать все разом.</p>}
        </section>
      )}
    </div>
  );
}
