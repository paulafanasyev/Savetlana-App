/**
 * Фото к черновикам пачкой: Светлана раскладывает файлы по карточкам по
 * имени файла. «krossovki-nike-1.jpg» и «Кроссовки Nike 2.jpg» уйдут к
 * черновику «Кроссовки Nike Air Max», файл с кодом товара в имени к товару с
 * этим кодом. Если подходят две карточки одинаково, файл не раскладываем:
 * продавец выберет сам. Чистые функции, без базы.
 */

export const MAX_PHOTOS_PER_PRODUCT = 8;

export interface DraftForPhotos {
  id: string;
  title: string;
  sku: string;
  /** Сколько фото у карточки уже есть. */
  photos: number;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const NOISE = new Set([
  "img", "image", "photo", "foto", "фото", "фотография", "dsc", "dcim", "pic", "picture", "copy", "копия",
  "jpg", "jpeg", "png", "webp", "heic", "screenshot", "снимок", "экрана", "whatsapp", "telegram", "edited",
  "новый", "новая", "новые", "для", "the", "and",
]);

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function translit(s: string): string {
  return [...norm(s)].map((ch) => TRANSLIT[ch] ?? ch).join("");
}

/** Слова из названия или имени файла: без расширения, номеров и служебных слов. */
export function words(s: string): string[] {
  return [...new Set(
    norm(s)
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .split(/[^a-zа-я0-9]+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.has(w)),
  )];
}

function same(a: string, b: string): boolean {
  if (a === b) return true;
  // Основа слова: «кроссовки» и «кроссовок», «krossovki» и «krossovok».
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 4;
}

/** Насколько имя файла похоже на карточку. 100 и больше: в имени есть код товара. */
export function matchScore(fileName: string, draft: Pick<DraftForPhotos, "title" | "sku">): number {
  const name = norm(fileName);
  const sku = norm(draft.sku);
  if (sku.length >= 4 && name.replace(/[^a-z0-9а-я-]/g, "").includes(sku.replace(/[^a-z0-9а-я-]/g, ""))) return 100;
  const fileWords = words(fileName).map(translit);
  const titleWords = words(draft.title).flatMap((w) => [w, translit(w)]);
  return fileWords.filter((fw) => titleWords.some((tw) => same(fw, tw))).length;
}

/** Лучшая карточка для файла или null, если ничего не подходит или две подходят одинаково. */
export function bestDraft(fileName: string, drafts: DraftForPhotos[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const d of drafts) {
    const score = matchScore(fileName, d);
    if (score > bestScore) {
      best = d.id;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

export interface PhotoPlanItem {
  productId: string;
  files: string[];
}

/**
 * Группы для загрузки: файлы по карточкам, по имени файла (первое фото
 * станет главным), не больше 8 фото на карточку с учётом уже загруженных.
 */
export function planPhotoUpload(assignment: Record<string, string | null>, drafts: DraftForPhotos[]): { groups: PhotoPlanItem[]; overflow: string[] } {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const grouped = new Map<string, string[]>();
  for (const [file, productId] of Object.entries(assignment)) {
    if (!productId || !byId.has(productId)) continue;
    grouped.set(productId, [...(grouped.get(productId) ?? []), file]);
  }
  const groups: PhotoPlanItem[] = [];
  const overflow: string[] = [];
  for (const [productId, files] of grouped) {
    const room = Math.max(0, MAX_PHOTOS_PER_PRODUCT - (byId.get(productId)?.photos ?? 0));
    const sorted = [...files].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
    if (sorted.length > room) overflow.push(...sorted.slice(room));
    if (room > 0) groups.push({ productId, files: sorted.slice(0, room) });
  }
  return { groups, overflow };
}
