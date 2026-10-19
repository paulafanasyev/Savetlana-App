/**
 * Город отгрузки продавца: откуда он отправляет товары и где их можно забрать.
 * Хранится как адрес пользователя-продавца с пометкой SHIP_FROM_LABEL, без новой
 * колонки в базе. Город берётся из того же справочника, что и «Мой город»
 * (lib/geo-data.ts), поэтому фильтр «из моего города» сравнивает одинаковые названия.
 */
import { allCities, normalizeCityName } from "./geo-data";

export const SHIP_FROM_LABEL = "Город отгрузки";

/** Точное название города из справочника (без учёта регистра и «ё») или null. */
export function resolveShipCity(raw: unknown): { name: string; regionName: string } | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 80) return null;
  const key = normalizeCityName(s);
  const found = allCities().find((c) => normalizeCityName(c.name) === key);
  return found ? { name: found.name, regionName: found.regionName } : null;
}

/**
 * Демо-магазинам площадки разные города, чтобы фильтр было видно сразу. Настоящие
 * продавцы указывают свой город в кабинете.
 */
export const DEMO_SHIP_CITIES: Record<string, string> = {
  "Демо-магазин СпортШаг": "Москва",
  "Демо-магазин ТехноДом": "Санкт-Петербург",
  "Демо-магазин Уютный дом": "Казань",
  "Демо-магазин СтильЛаб": "Екатеринбург",
  "Демо-магазин МастерПро": "Новосибирск",
  "Демо-опт ЗащитаПро": "Нижний Новгород",
  "Демо-опт СнабЦентр": "Москва",
  "Демо-опт УпакСервис": "Самара",
};

/** Подпись на карточке товара. */
export function shipFromText(city: string | null | undefined): string {
  return city ? `Отправка из г. ${city}` : "";
}
