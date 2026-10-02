/**
 * Display labels for the classified verticals (real estate, auto, services).
 *
 * Both the list and the detail page render these, and both previously carried
 * their own hand-written copy. The two drifted apart and both used keys that
 * are not members of the canonical enum (`RENT_LONG`, `RENT_SHORT`, `BUY`), so
 * affected filters rendered a raw code or nothing at all. One typed source
 * removes the possibility of that recurring: the `Record<Enum, string>` type
 * makes a non-canonical key a compile error.
 */
import { ClassifiedDealType, ClassifiedVertical, asEnum } from "./db/enums";

export const VERTICAL_LABELS: Record<ClassifiedVertical, string> = {
  REAL_ESTATE: "Недвижимость",
  AUTO: "Авто",
  SERVICE: "Услуги",
};

export const DEAL_TYPE_LABELS: Record<ClassifiedDealType, string> = {
  SELL: "Продажа",
  RENT: "Сдаю в аренду",
  LONG_RENT: "Аренда (длительно)",
  DAILY_RENT: "Посуточно",
  BUY_REQUEST: "Куплю",
  SERVICE_OFFER: "Предлагаю услугу",
  SERVICE_REQUEST: "Нужна услуга",
};

/** Placeholder glyph shown when a listing has no photo. */
export const VERTICAL_EMOJI: Record<ClassifiedVertical, string> = {
  REAL_ESTATE: "🏠",
  AUTO: "🚗",
  SERVICE: "🛠",
};

/** Both columns are stored as plain strings, so an unexpected value falls back
 *  to itself rather than rendering "undefined". */
export const verticalLabel = (value: string): string => {
  const vertical = asEnum<ClassifiedVertical>("ClassifiedVertical", value);
  return vertical ? VERTICAL_LABELS[vertical] : value;
};

export const verticalEmoji = (value: string): string => {
  const vertical = asEnum<ClassifiedVertical>("ClassifiedVertical", value);
  return vertical ? VERTICAL_EMOJI[vertical] : "🏠";
};

export const dealTypeLabel = (value: string): string => {
  const dealType = asEnum<ClassifiedDealType>("ClassifiedDealType", value);
  return dealType ? DEAL_TYPE_LABELS[dealType] : value;
};