/**
 * Города рядом: расстояние по прямой между центрами городов из справочника.
 * Нужно, чтобы в маленьком городе показать объявления из соседних.
 */
import { allCities, normalizeCityName } from "./geo-data";

const R = 6371;

/** Расстояние по прямой, км (формула гаверсинусов). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Соседние города в радиусе, ближние первыми. Сам город не входит. */
export function nearbyCities(name: string, radiusKm = 300, limit = 12): { name: string; km: number }[] {
  const all = allCities();
  const key = normalizeCityName(name);
  const me = all.find((c) => normalizeCityName(c.name) === key);
  if (!me) return [];
  return all
    .filter((c) => c !== me)
    .map((c) => ({ name: c.name, km: Math.round(distanceKm(me, c)) }))
    .filter((c) => c.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** Расстояние между двумя городами по названию, км. null, если города нет в справочнике. */
export function kmBetween(from: string, to: string): number | null {
  const all = allCities();
  const find = (name: string) => {
    const key = normalizeCityName(name);
    return all.find((c) => normalizeCityName(c.name) === key);
  };
  const a = find(from);
  const b = find(to);
  if (!a || !b) return null;
  return Math.round(distanceKm(a, b));
}

/** Подпись расстояния для карточки. */
export function kmLabel(km: number | null): string {
  if (km === null) return "";
  if (km < 1) return "в вашем городе";
  return `≈ ${km.toLocaleString("ru-RU")} км`;
}
