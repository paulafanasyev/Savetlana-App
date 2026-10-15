"use client";

import { useEffect, useRef, useState } from "react";
import {
  ATTR_PREFIX,
  MAX_PHOTOS,
  MAX_PHOTOS_TOTAL_BYTES,
  fieldsFor,
  priceLabel,
  type FieldDef,
} from "@/lib/classified-fields";
import { VacancyDraftHelper, type VacancyDraftResult } from "@/components/VacancyDraftHelper";
import { removedNote, scrubResumeListing } from "@/lib/domains/contact-scrub";
import { cityFromText } from "@/lib/city-from-text";

export interface GeoOption {
  id: string;
  name: string;
  regions: { id: string; name: string; cities: { id: string; name: string }[] }[];
}

const DEALS: Record<string, { value: string; label: string }[]> = {
  REAL_ESTATE: [
    { value: "SELL", label: "Продажа" },
    { value: "LONG_RENT", label: "Аренда (длительно)" },
    { value: "DAILY_RENT", label: "Посуточно" },
    { value: "BUY_REQUEST", label: "Куплю" },
  ],
  AUTO: [
    { value: "SELL", label: "Продажа" },
    { value: "DAILY_RENT", label: "Аренда посуточно" },
    { value: "BUY_REQUEST", label: "Куплю" },
  ],
  SERVICE: [
    { value: "SERVICE_OFFER", label: "Предлагаю услугу" },
    { value: "SERVICE_REQUEST", label: "Нужна услуга" },
  ],
  JOB: [
    { value: "VACANCY", label: "Вакансия: ищу сотрудника" },
    { value: "RESUME", label: "Резюме: ищу работу" },
  ],
};

const CATEGORY_HINT: Record<string, string> = {
  REAL_ESTATE: "Например: Квартиры",
  AUTO: "Например: Автомобили",
  SERVICE: "Например: Ремонт и отделка",
  JOB: "Например: Продажи, Склад, IT",
};

const TITLE_HINT: Record<string, string> = {
  REAL_ESTATE: "Например: 2-комнатная квартира у метро",
  AUTO: "Например: Toyota Camry 2019, один владелец",
  SERVICE: "Например: Ремонт ванной под ключ",
  JOB: "Например: Продавец-консультант в магазин техники",
};

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm";
const MAX_SIDE = 1600;

/** Уменьшает фото в браузере до 1600 px по длинной стороне (JPEG), чтобы влезть в лимит отправки. */
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
  return blob;
}

function Field({ f }: { f: FieldDef }) {
  const name = ATTR_PREFIX + f.key;
  const label = f.unit ? `${f.label}, ${f.unit}` : f.label;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      {f.type === "select" ? (
        <select id={name} name={name} className={input} defaultValue="">
          <option value="">Не указано</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type={f.type === "number" ? "number" : "text"}
          inputMode={f.type === "number" ? (f.step ? "decimal" : "numeric") : undefined}
          min={f.min}
          max={f.max}
          step={f.step ?? (f.type === "number" ? 1 : undefined)}
          maxLength={f.maxLength}
          placeholder={f.placeholder}
          className={input}
        />
      )}
    </div>
  );
}

export function ClassifiedForm({ tree }: { tree: GeoOption[] }) {
  const [vertical, setVertical] = useState("REAL_ESTATE");
  const [dealType, setDealType] = useState("SELL");
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cityNote, setCityNote] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [resumeText, setResumeText] = useState("");

  // Ссылка из чата со Светланой: /classifieds/new?resume=… открывает резюме с уже вставленным текстом.
  useEffect(() => {
    const text = new URLSearchParams(window.location.search).get("resume")?.trim() ?? "";
    if (text.length < 15) return;
    setVertical("JOB");
    setDealType("RESUME");
    setResumeText(text.slice(0, 2000));
  }, []);

  /** Черновик Светланы в поля формы. Поля остаются обычными: человек правит что угодно. */
  const applyDraft = (d: VacancyDraftResult) => {
    const form = formRef.current;
    if (!form) return;
    const put = (name: string, value: string) => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.value = value;
    };
    if (d.title) put("title", d.title.slice(0, 120));
    if (d.category) put("category", d.category.slice(0, 80));
    if (d.description) put("description", d.description.slice(0, 5000));
    if (d.salaryFrom) put("priceRub", String(d.salaryFrom));
    for (const [key, value] of Object.entries(d.attrs)) put(ATTR_PREFIX + key, value);
    // «Живу в Казани»: город из текста, если он есть в справочнике. Нет в тексте: поле не трогаем.
    const cities = tree.flatMap((d) => d.regions.flatMap((r) => r.cities));
    const city = cityFromText(`${d.title}\n${d.description}`, cities);
    if (city) {
      put("cityId", city.id);
      setCityNote(`Город «${city.name}» взяла из текста. Если не тот, выберите другой.`);
    } else {
      setCityNote(null);
    }
  };

  const deals = DEALS[vertical] ?? [];
  const changeVertical = (v: string) => {
    setVertical(v);
    setDealType(DEALS[v]?.[0]?.value ?? "SELL");
  };

  const pickPhotos = (list: FileList | null) => {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    const room = Math.max(0, MAX_PHOTOS - photos.length);
    if (picked.length > room) setError(`Можно добавить не больше ${MAX_PHOTOS} фото`);
    else setError(null);
    setPhotos([...photos, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // Резюме: телефон и почту в открытом объявлении собирают мошенники. Убираем и показываем, что изменилось.
    if (vertical === "JOB" && dealType === "RESUME") {
      const titleEl = e.currentTarget.elements.namedItem("title");
      const descEl = e.currentTarget.elements.namedItem("description");
      if (titleEl instanceof HTMLInputElement && descEl instanceof HTMLTextAreaElement) {
        const cleaned = scrubResumeListing({ vertical, dealType, title: titleEl.value, description: descEl.value });
        if (cleaned.removed.length) {
          titleEl.value = cleaned.title;
          descEl.value = cleaned.description;
          setNotice(`${removedNote(cleaned.removed)} Проверьте текст и нажмите «Опубликовать» ещё раз.`);
          setBusy(false);
          return;
        }
      }
    }
    try {
      const data = new FormData(e.currentTarget);
      data.delete("photos");
      let total = 0;
      for (const { file } of photos) {
        const blob = await shrinkPhoto(file);
        total += blob.size;
        if (total > MAX_PHOTOS_TOTAL_BYTES) {
          throw new Error("Фото получились слишком тяжёлыми для одной отправки. Уберите часть и добавьте их позже");
        }
        data.append("photos", blob, `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`);
      }
      const res = await fetch("/api/classifieds", { method: "POST", body: data, headers: { Accept: "application/json" } });
      const body = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: string };
      if (res.status === 401) throw new Error("Войдите в аккаунт, чтобы разместить объявление");
      if (!res.ok || !body.id) throw new Error(body.error ?? "Не удалось разместить объявление");
      location.assign(body.status === "MODERATION" ? "/classifieds/new?sent=moderation" : `/classifieds/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось разместить объявление");
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="vertical">Раздел</label>
          <select id="vertical" name="vertical" className={input} value={vertical} onChange={(e) => changeVertical(e.target.value)}>
            <option value="REAL_ESTATE">Недвижимость</option>
            <option value="AUTO">Авто</option>
            <option value="SERVICE">Услуги</option>
            <option value="JOB">Работа</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="dealType">Тип сделки</label>
          <select id="dealType" name="dealType" className={input} value={dealType} onChange={(e) => setDealType(e.target.value)}>
            {deals.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {vertical === "JOB" && (
        <VacancyDraftHelper
          key={`${dealType}-${resumeText.length}`}
          kind={dealType === "RESUME" ? "resume" : "vacancy"}
          initialText={dealType === "RESUME" ? resumeText : ""}
          onDraft={applyDraft}
        />
      )}

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="title">Заголовок</label>
        <input id="title" name="title" required minLength={5} maxLength={120} placeholder={TITLE_HINT[vertical]} className={input} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="category">Категория</label>
        <input id="category" name="category" required maxLength={80} placeholder={CATEGORY_HINT[vertical]} className={input} />
      </div>

      <fieldset className="rounded-lg border border-zinc-200 p-4">
        <legend className="px-1 text-sm font-semibold">Характеристики</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {fieldsFor(vertical).map((f) => (
            <Field key={`${vertical}-${f.key}`} f={f} />
          ))}
        </div>
      </fieldset>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="description">Описание</label>
        <textarea id="description" name="description" rows={5} maxLength={5000} className={input} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="priceRub">{priceLabel(dealType)}</label>
        <input id="priceRub" name="priceRub" type="number" min={0} step={1} inputMode="numeric" className={input} />
      </div>

      {vertical === "JOB" && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Вакансии с платой за обучение, форму или оформление, а также набор «курьеров за наличными» и «держателей карт» не публикуются. Не просите у соискателей фото паспорта до собеседования.
        </p>
      )}

      <div>
        <span className="mb-1 block text-sm font-medium">Фото (до {MAX_PHOTOS})</span>
        <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-600 hover:bg-zinc-50">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="sr-only" onChange={(e) => { pickPhotos(e.target.files); e.target.value = ""; }} />
          + Добавить фото
        </label>
        {photos.length > 0 && (
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p, i) => (
              <li key={p.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.file.name} className="aspect-square w-full rounded-lg object-cover" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px]">обложка</span>}
                <button
                  type="button"
                  aria-label={`Убрать ${p.file.name}`}
                  className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-xs"
                  onClick={() => {
                    URL.revokeObjectURL(p.url);
                    setPhotos(photos.filter((_, j) => j !== i));
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-zinc-500">Первое фото станет обложкой. Фото уменьшаются перед отправкой, качество для объявления сохраняется.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="cityId">Город</label>
        <select id="cityId" name="cityId" required className={input} onChange={() => setCityNote(null)}>
          {tree.map((d) => (
            <optgroup key={d.id} label={d.name}>
              {d.regions.map((r) =>
                r.cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({r.name})
                  </option>
                ))
              )}
            </optgroup>
          ))}
        </select>
        {cityNote && <p className="mt-1 text-xs text-svetlana-700" role="status">{cityNote}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="districtName">Район / населённый пункт</label>
          <input id="districtName" name="districtName" maxLength={120} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="addressLine">Адрес</label>
          <input id="addressLine" name="addressLine" maxLength={200} className={input} />
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <button type="submit" disabled={busy} className="rounded-lg bg-zinc-900 px-6 py-2 text-sm font-medium text-white disabled:opacity-60">
        {busy ? "Отправляем…" : "Опубликовать"}
      </button>
    </form>
  );
}
