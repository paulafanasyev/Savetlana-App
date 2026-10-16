/**
 * Раздел «Фриланс»: заказы на услуги (там исполнители предлагают цену и срок)
 * и услуги исполнителей. Здесь только чистые правила для вкладок и фильтра.
 */

export type FreelanceTab = "orders" | "offers";

export const FREELANCE_TABS: Record<FreelanceTab, string> = {
  orders: "Заказы",
  offers: "Услуги исполнителей",
};

/** Какому типу объявления соответствует вкладка. */
export const TAB_DEAL_TYPE: Record<FreelanceTab, string> = {
  orders: "SERVICE_REQUEST",
  offers: "SERVICE_OFFER",
};

export function freelanceTab(raw: unknown): FreelanceTab {
  return raw === "offers" ? "offers" : "orders";
}

/** Категория из адреса принимается, только если такая реально есть в разделе. */
export function pickCategory(raw: unknown, known: readonly string[]): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v && known.includes(v) ? v : null;
}

/** Ссылка на вкладку и категорию. */
export function freelanceHref(tab: FreelanceTab, category?: string | null): string {
  const q = new URLSearchParams();
  if (tab !== "orders") q.set("tab", tab);
  if (category) q.set("category", category);
  const s = q.toString();
  return s ? `/freelance?${s}` : "/freelance";
}

/** Какие раздел и тип сделки можно сразу выбрать в форме объявления по ссылке. */
const FORM_PRESETS: Record<string, string[]> = {
  SERVICE: ["SERVICE_REQUEST", "SERVICE_OFFER"],
  JOB: ["VACANCY", "RESUME"],
};

/** /classifieds/new?vertical=SERVICE&deal=SERVICE_REQUEST: форма сразу на нужном типе. */
export function formPreset(vertical: unknown, deal: unknown): { vertical: string; dealType: string } | null {
  if (typeof vertical !== "string" || typeof deal !== "string") return null;
  return FORM_PRESETS[vertical]?.includes(deal) ? { vertical, dealType: deal } : null;
}

/** Ссылка на форму: заказ услуги или предложение услуги. */
export function freelanceFormHref(tab: FreelanceTab): string {
  return `/classifieds/new?vertical=SERVICE&deal=${TAB_DEAL_TYPE[tab]}`;
}
