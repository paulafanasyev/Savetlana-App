/**
 * Массовое изменение цен и остатков: чистые правила разбора и проверки.
 * CSV в формате «Код;Название;Цена;Остаток» (как выгружает кабинет).
 */
export interface BulkCurrent {
  id: string;
  sku: string;
  title: string;
  status: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  quantity: number;
}

export interface BulkItem {
  id: string;
  priceRub?: number;
  stockQuantity?: number;
}

export interface BulkChange {
  id: string;
  title: string;
  priceFrom?: number;
  priceTo?: number;
  stockFrom?: number;
  stockTo?: number;
}

export const BULK_MAX_ITEMS = 300;

/** Делит запрос на изменения и пропуски с понятной причиной. */
export function planBulk(
  current: BulkCurrent[],
  items: BulkItem[],
  opts: { verified: boolean }
): { changes: BulkChange[]; skipped: { title: string; reason: string }[] } {
  const byId = new Map(current.map((c) => [c.id, c]));
  const changes: BulkChange[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, BULK_MAX_ITEMS)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const p = byId.get(item.id);
    if (!p) {
      skipped.push({ title: item.id, reason: "товар не найден в вашем каталоге" });
      continue;
    }
    const change: BulkChange = { id: p.id, title: p.title };
    if (item.priceRub !== undefined) {
      const kop = Math.round(Number(item.priceRub) * 100);
      const onPromo = p.oldPriceKopecks !== null && p.oldPriceKopecks > p.priceKopecks;
      if (!Number.isFinite(kop) || kop < 100) {
        skipped.push({ title: p.title, reason: "цена не изменена: она должна быть от 1 ₽" });
      } else if (kop !== p.priceKopecks && onPromo) {
        skipped.push({ title: p.title, reason: "цена не изменена: идёт скидка, сначала верните обычную цену в «Акциях»" });
      } else if (kop !== p.priceKopecks && p.status === "ACTIVE" && !opts.verified) {
        skipped.push({ title: p.title, reason: "цена не изменена: менять цену опубликованного товара можно после проверки продавца" });
      } else if (kop !== p.priceKopecks) {
        change.priceFrom = p.priceKopecks;
        change.priceTo = kop;
      }
    }
    if (item.stockQuantity !== undefined) {
      const q = Number(item.stockQuantity);
      if (!Number.isInteger(q) || q < 0 || q > 1_000_000) {
        skipped.push({ title: p.title, reason: "остаток не изменён: нужно целое число от 0" });
      } else if (q !== p.quantity) {
        change.stockFrom = p.quantity;
        change.stockTo = q;
      }
    }
    if (change.priceTo !== undefined || change.stockTo !== undefined) changes.push(change);
  }
  return { changes, skipped };
}

function cell(value: string | number): string {
  const s = String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: { sku: string; title: string; priceKopecks: number; quantity: number }[]): string {
  const lines = ["Код;Название;Цена;Остаток", ...rows.map((r) => [r.sku, r.title, (r.priceKopecks / 100).toString(), r.quantity].map(cell).join(";"))];
  return lines.join("\n");
}

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Разбирает CSV: товар ищется по коду (первый столбец). Цена и остаток
 * необязательны, пустая ячейка значит «не менять».
 */
export function parseCsv(text: string): { rows: { sku: string; priceRub?: number; stockQuantity?: number }[]; errors: string[] } {
  const rows: { sku: string; priceRub?: number; stockQuantity?: number }[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  lines.forEach((line, index) => {
    const cells = splitRow(line);
    if (index === 0 && /код|sku/i.test(cells[0] ?? "")) return;
    const sku = cells[0];
    if (!sku) return;
    const price = num(cells[2]);
    const stock = num(cells[3]);
    if (Number.isNaN(price) || Number.isNaN(stock)) {
      errors.push(`строка ${index + 1}: цена и остаток должны быть числами`);
      return;
    }
    rows.push({ sku, priceRub: price, stockQuantity: stock });
  });
  return { rows, errors };
}
