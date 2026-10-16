/**
 * Профиль исполнителя: что о нём честно можно сказать заказчику. Только факты
 * площадки: сколько сделок завершено через безопасную сделку, сколько сейчас в
 * работе, были ли споры, что проверено (самозанятость, личность). Никаких
 * выдуманных рейтингов: оценка только из отзывов заказчиков по принятой работе.
 * Здесь только чистые правила.
 */
import { ratingText } from "./service-reviews";

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export interface PerformerStats {
  completed: number;
  inWork: number;
  disputed: number;
  bids: number;
}

export interface PerformerFactsInput {
  stats: PerformerStats;
  npdStatus?: string | null;
  identityStatus?: string | null;
  since: Date;
  /** Оценки из отзывов заказчиков (1..5). */
  ratings?: number[];
}

function n0(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** «На площадке с октября 2026». */
export function sinceText(d: Date): string {
  return `На площадке с ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

export function performerFacts(input: PerformerFactsInput): string[] {
  const s = input.stats;
  const out: string[] = [];
  const completed = n0(s.completed);
  out.push(completed > 0 ? `Завершённых сделок через безопасную сделку: ${completed}` : "Завершённых сделок на площадке пока нет");
  const rating = ratingText(input.ratings ?? []);
  if (rating) out.push(rating);
  if (n0(s.inWork) > 0) out.push(`Сейчас в работе: ${n0(s.inWork)}`);
  if (n0(s.disputed) > 0) out.push(`Открытых споров: ${n0(s.disputed)}`);
  if (n0(s.bids) > 0) out.push(`Предложений по заказам: ${n0(s.bids)}`);
  if (input.npdStatus === "VERIFIED") out.push("Самозанятый: статус проверен в ФНС");
  if (input.identityStatus === "VERIFIED") out.push("Личность подтверждена");
  out.push(sinceText(input.since));
  return out;
}

/** Профиль показываем, только если человек работает исполнителем на площадке. */
export function isPerformer(stats: PerformerStats, offers: number): boolean {
  return n0(stats.completed) + n0(stats.inWork) + n0(stats.disputed) + n0(stats.bids) + n0(offers) > 0;
}
