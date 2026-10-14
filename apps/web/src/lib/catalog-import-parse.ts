/**
 * Разбор файлов с товарами для переноса магазина: выгрузки Яндекс Маркета,
 * Ozon и Wildberries (Excel .xlsx или .csv), прайс-листы и выгрузки 1С (.csv),
 * фиды YML (.xml / .yml, их отдают 1С, InSales, Тильда и большинство CMS).
 *
 * В книге Excel из кабинета Маркета первым листом часто идёт инструкция, а
 * товары лежат на другом листе. Поэтому смотрим все видимые листы и берём тот,
 * где нашлось больше всего товаров.
 *
 * Модуль не зависит ни от браузера, ни от сервера: им пользуется страница
 * импорта (разбор файла у продавца, на сервер уходит только список товаров),
 * а сервер повторно проверяет каждую строку в catalog-import.ts.
 */

export interface ImportItem {
  article: string;
  title: string;
  description: string;
  priceRub: number;
  oldPriceRub?: number;
  quantity?: number;
  images: string[];
  brand?: string;
  barcode?: string;
}

export interface ParseResult {
  items: ImportItem[];
  /** Строки, которые не удалось разобрать: номер строки и причина. */
  problems: { row: number; reason: string }[];
  /** Какие колонки файла мы узнали (для показа продавцу). */
  columns: Partial<Record<Field, string>>;
  format: "table" | "yml";
  /** Лист книги Excel, с которого взяли товары (если листов несколько). */
  sheet?: string;
  /** Откуда, похоже, выгрузка: «Яндекс Маркет», «Ozon», «Wildberries». */
  source?: string;
}

type Field = "article" | "title" | "description" | "price" | "oldPrice" | "quantity" | "images" | "brand" | "barcode";

export const IMPORT_MAX_ITEMS = 2000;

const FIELD_LABELS: Record<Field, string> = {
  article: "Артикул",
  title: "Название",
  description: "Описание",
  price: "Цена",
  oldPrice: "Цена до скидки",
  quantity: "Остаток",
  images: "Фото",
  brand: "Бренд",
  barcode: "Штрихкод",
};
export { FIELD_LABELS };

function norm(header: string): string {
  return header.toLowerCase().replace(/ё/g, "е").replace(/[*"«»]/g, "").replace(/\s+/g, " ").trim();
}

/** Какое поле товара означает заголовок колонки. Порядок проверок важен. */
export function fieldOfHeader(header: string): Field | null {
  const h = norm(header);
  if (!h) return null;
  if (/штрих|баркод|barcode|\bean\b|gtin/.test(h)) return "barcode";
  // Номер карточки на самом Маркете не артикул продавца: берём «Ваш SKU».
  if (/sku на маркете|маркет sku|market sku|sku маркета|sku яндекс/.test(h)) return null;
  if (/артикул|vendorcode|offer_id|offer id|\bsku\b|^код( товара)?$/.test(h)) return "article";
  if (/до скидки|старая цена|зачеркнут|oldprice|цена без скидки/.test(h)) return "oldPrice";
  if (/себестоим|закуп|минимальн|рекоменд|ндс|комисси|логистик/.test(h)) return null;
  if (/цена|стоимость|price/.test(h)) return "price";
  if (/описание|аннотац|description/.test(h)) return "description";
  if (/остат|количеств|в наличии|доступно|stock|\bqty\b|quantity/.test(h)) return "quantity";
  if (/фото|изображ|картин|picture|image|медиа/.test(h)) return "images";
  if (/бренд|производител|торговая марка|brand|vendor/.test(h)) return "brand";
  if (/^(название|наименование|name|товар|title)(\s|,|\(|$)|название товара|наименование товара/.test(h)) return "title";
  return null;
}

export function parseMoney(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = String(raw).replace(/[\s\u00a0]/g, "").replace(/руб\.?|₽|р\.|rub/gi, "").replace(",", ".");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : undefined;
}

function parseCount(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === "") return undefined;
  const value = Number(String(raw).replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function urls(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(String(raw).matchAll(/https?:\/\/[^\s;,"'<>]+/g), (m) => m[0].replace(/^http:\/\//, "https://"));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** CSV с автоопределением разделителя (; , или табуляция) и кавычками. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const counts: [string, number][] = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length]);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Таблица (CSV или Excel) -> товары
// ---------------------------------------------------------------------------

export function rowsToItems(rows: string[][]): ParseResult {
  // Заголовок не всегда в первой строке: в шаблонах Ozon и WB сверху бывают
  // пояснения. Берём строку из первых 15, где узнали больше всего колонок.
  let headerIndex = -1;
  let best: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map: Partial<Record<Field, number>> = {};
    rows[r].forEach((h, c) => {
      const f = fieldOfHeader(h);
      if (!f) return;
      // Из нескольких артикулов (WB: «Артикул WB» и «Артикул продавца», Маркет:
      // «Ваш SKU») берём артикул продавца.
      if (map[f] === undefined || (f === "article" && /продавц|ваш/i.test(h))) map[f] = c;
    });
    if (map.title !== undefined && map.price !== undefined && Object.keys(map).length > Object.keys(best).length) {
      best = map;
      headerIndex = r;
    }
  }
  if (headerIndex === -1) {
    return { items: [], problems: [{ row: 1, reason: "Не нашли колонки «Название» и «Цена». Проверьте, что в файле есть строка с заголовками." }], columns: {}, format: "table" };
  }
  const header = rows[headerIndex];
  const imageCols = header.map((h, c) => (fieldOfHeader(h) === "images" ? c : -1)).filter((c) => c >= 0);
  const columns: Partial<Record<Field, string>> = {};
  for (const [f, c] of Object.entries(best) as [Field, number][]) columns[f] = header[c];

  const items: ImportItem[] = [];
  const problems: ParseResult["problems"] = [];
  const cell = (row: string[], f: Field) => (best[f] === undefined ? undefined : (row[best[f]!] ?? "").trim());
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const title = cell(row, "title") ?? "";
    const priceRaw = cell(row, "price");
    const price = parseMoney(priceRaw);
    if (!title && !priceRaw) continue;
    // Строки-подсказки шаблонов («Обязательное поле», «Введите цену») пропускаем молча.
    if (title && priceRaw && price === undefined && !/\d/.test(priceRaw)) continue;
    if (!title) { problems.push({ row: r + 1, reason: "нет названия" }); continue; }
    if (price === undefined) { problems.push({ row: r + 1, reason: `«${title.slice(0, 40)}»: нет цены` }); continue; }
    const oldPrice = parseMoney(cell(row, "oldPrice"));
    items.push({
      article: cell(row, "article") ?? "",
      title,
      description: cell(row, "description") ?? "",
      priceRub: price,
      oldPriceRub: oldPrice && oldPrice > price ? oldPrice : undefined,
      quantity: parseCount(cell(row, "quantity")),
      images: Array.from(new Set(imageCols.flatMap((c) => urls(row[c])))).slice(0, 10),
      brand: cell(row, "brand") || undefined,
      barcode: cell(row, "barcode") || undefined,
    });
  }
  return { items, problems, columns, format: "table", source: detectSource(header) };
}

/** По заголовкам колонок угадываем, из какого кабинета выгрузка. */
export function detectSource(header: string[]): string | undefined {
  const all = header.map(norm).join(" | ");
  if (/ваш sku|на маркете|яндекс|маркет sku|market sku/.test(all)) return "Яндекс Маркет";
  if (/ozon|озон/.test(all)) return "Ozon";
  if (/\bwb\b|wildberries|вайлдберриз/.test(all)) return "Wildberries";
  return undefined;
}

// ---------------------------------------------------------------------------
// YML (Яндекс Маркет)
// ---------------------------------------------------------------------------

function decodeXml(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const text = cdata ? cdata[1] : raw;
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]).trim() : undefined;
}

export function parseYml(xml: string): ParseResult {
  const items: ImportItem[] = [];
  const problems: ParseResult["problems"] = [];
  const offers = Array.from(xml.matchAll(/<offer\b([^>]*)>([\s\S]*?)<\/offer>/gi));
  if (offers.length === 0) {
    return { items, problems: [{ row: 1, reason: "В файле не нашли товаров (тегов <offer>). Это точно фид YML?" }], columns: {}, format: "yml" };
  }
  offers.forEach((m, i) => {
    const attrs = m[1];
    const body = m[2];
    const id = attrs.match(/\bid\s*=\s*"([^"]*)"/i)?.[1] ?? "";
    const name = tag(body, "name") ?? [tag(body, "typePrefix"), tag(body, "vendor"), tag(body, "model")].filter(Boolean).join(" ");
    const price = parseMoney(tag(body, "price"));
    if (!name) { problems.push({ row: i + 1, reason: `товар ${id || i + 1}: нет названия` }); return; }
    if (price === undefined) { problems.push({ row: i + 1, reason: `«${name.slice(0, 40)}»: нет цены` }); return; }
    const oldPrice = parseMoney(tag(body, "oldprice"));
    const available = attrs.match(/\bavailable\s*=\s*"([^"]*)"/i)?.[1];
    const count = parseCount(tag(body, "count") ?? tag(body, "quantity") ?? tag(body, "stock"));
    items.push({
      article: tag(body, "vendorCode") ?? id,
      title: name,
      description: htmlToText(tag(body, "description") ?? ""),
      priceRub: price,
      oldPriceRub: oldPrice && oldPrice > price ? oldPrice : undefined,
      quantity: count ?? (available === "false" ? 0 : undefined),
      images: Array.from(body.matchAll(/<picture>([\s\S]*?)<\/picture>/gi), (p) => urls(decodeXml(p[1]))[0]).filter(Boolean).slice(0, 10),
      brand: tag(body, "vendor"),
      barcode: tag(body, "barcode"),
    });
  });
  return { items, problems, columns: {}, format: "yml" };
}

// ---------------------------------------------------------------------------
// Excel .xlsx: zip + XML, без сторонних библиотек
// ---------------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Копия в отдельный ArrayBuffer: Blob не принимает срез общего буфера по типам TS.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Файл повреждён или это не Excel (.xlsx)");
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<string>>();
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return decoder.decode(data);
      if (method === 8) return decoder.decode(await inflateRaw(data));
      throw new Error("Неподдерживаемое сжатие в файле Excel");
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function sharedStrings(files: Map<string, () => Promise<string>>): Promise<string[]> {
  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml");
  if (sst) {
    const xml = await sst();
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(Array.from(si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (t) => decodeXml(t[1])).join(""));
    }
  }
  return shared;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      let value = "";
      if (type === "inlineStr") value = Array.from(inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (t) => decodeXml(t[1])).join("");
      else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
      }
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function relTarget(relsXml: string, rid: string): string | undefined {
  const target =
    relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ??
    relsXml.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  if (!target) return undefined;
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/** Все видимые листы книги Excel по порядку. Скрытые листы (списки значений шаблона) пропускаем. */
export async function parseXlsxSheets(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const files = await unzip(buffer);
  const shared = await sharedStrings(files);
  const wb = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  const sheets: XlsxSheet[] = [];
  if (wb && rels) {
    const relsXml = await rels();
    for (const m of (await wb()).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const attrs = m[1];
      if (/\bstate="(hidden|veryHidden)"/.test(attrs)) continue;
      const rid = attrs.match(/\br:id="([^"]+)"/)?.[1];
      const path = rid ? relTarget(relsXml, rid) : undefined;
      const file = path ? files.get(path) : undefined;
      if (!file) continue;
      sheets.push({ name: decodeXml(attrs.match(/\bname="([^"]*)"/)?.[1] ?? ""), rows: sheetRows(await file(), shared) });
    }
  }
  if (sheets.length === 0) {
    const fallback = files.get("xl/worksheets/sheet1.xml") ?? Array.from(files.entries()).find(([k]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))?.[1];
    if (!fallback) throw new Error("В файле Excel не нашли лист с данными");
    sheets.push({ name: "", rows: sheetRows(await fallback(), shared) });
  }
  return sheets;
}

/** Первый видимый лист книги Excel как таблица строк. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  return (await parseXlsxSheets(buffer))[0].rows;
}

/** Из листов книги выбираем тот, где больше всего товаров (при равенстве меньше ошибок). */
export function bestSheet(sheets: XlsxSheet[]): ParseResult {
  const results = sheets.map((s) => ({ ...rowsToItems(s.rows), sheet: sheets.length > 1 && s.name ? s.name : undefined }));
  const withItems = results.filter((r) => r.items.length > 0);
  if (withItems.length > 0) {
    return withItems.reduce((a, b) => (b.items.length > a.items.length || (b.items.length === a.items.length && b.problems.length < a.problems.length) ? b : a));
  }
  // Товаров нет нигде: покажем лист, где хотя бы узнали заголовки, иначе первый.
  return results.find((r) => Object.keys(r.columns).length > 0) ?? results[0];
}

/** Текст CSV: сначала UTF-8, а если файл из старого Excel/1С, то Windows-1251. */
export function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1251").decode(buffer);
}

/** Разбор файла любого поддерживаемого формата по имени и содержимому. */
export async function parseCatalogFile(name: string, buffer: ArrayBuffer): Promise<ParseResult> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) return bestSheet(await parseXlsxSheets(buffer));
  if (lower.endsWith(".xls")) {
    throw new Error("Старый формат .xls не поддерживается. Откройте файл в Excel и сохраните как .xlsx или .csv.");
  }
  const text = decodeText(buffer);
  if (lower.endsWith(".xml") || lower.endsWith(".yml") || /<yml_catalog|<offer\b/i.test(text.slice(0, 5000))) return parseYml(text);
  return rowsToItems(parseCsv(text));
}
