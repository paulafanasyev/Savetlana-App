/**
 * Строка места под городом: регион, район, адрес.
 * У Москвы, Петербурга и Севастополя регион называется так же, как город,
 * поэтому такой регион не повторяем.
 */
export function locationLine(input: { cityName: string; regionName: string; districtName?: string | null; addressLine?: string | null }): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");
  const parts: string[] = [];
  if (input.regionName && norm(input.regionName) !== norm(input.cityName)) parts.push(input.regionName);
  if (input.districtName?.trim()) parts.push(input.districtName.trim());
  if (input.addressLine?.trim()) parts.push(input.addressLine.trim());
  return parts.join(" · ");
}

/** Пример объявления от площадки: написать автору нельзя. */
export function isDemoAd(attrs: Record<string, unknown>): boolean {
  return attrs.demo === true;
}
