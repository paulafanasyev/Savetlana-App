/**
 * Реквизиты оператора площадки (АИКО).
 *
 * Закон о защите прав потребителей (ст. 26.1) и Правила продажи товаров
 * дистанционным способом требуют показать покупателю наименование, ОГРН,
 * адрес и контакты до покупки. Банки (Т-Банк, Сбер, Альфа, ЮKassa) проверяют
 * то же самое перед подключением эквайринга. Значения берутся только из
 * переменных окружения: в коде реквизитов нет, пустые поля честно
 * показываются как «не указано».
 */

export const LEGAL_ENV = {
  name: "COMPANY_LEGAL_NAME",
  inn: "COMPANY_INN",
  ogrn: "COMPANY_OGRN",
  address: "COMPANY_ADDRESS",
  email: "SUPPORT_EMAIL",
  phone: "SUPPORT_PHONE",
} as const;

export type LegalField = keyof typeof LEGAL_ENV;

export type LegalEntity = Record<LegalField, string | null>;

export const LEGAL_LABELS: Record<LegalField, string> = {
  name: "Наименование",
  inn: "ИНН",
  ogrn: "ОГРН / ОГРНИП",
  address: "Адрес",
  email: "Email поддержки",
  phone: "Телефон поддержки",
};

type EnvSource = Record<string, string | undefined>;

export function getLegalEntity(source: EnvSource = process.env): LegalEntity {
  const entity = {} as LegalEntity;
  for (const field of Object.keys(LEGAL_ENV) as LegalField[]) {
    const raw = source[LEGAL_ENV[field]];
    const value = typeof raw === "string" ? raw.trim() : "";
    entity[field] = value.length > 0 ? value : null;
  }
  return entity;
}

function digitsOf(value: string): number[] | null {
  if (!/^\d+$/.test(value)) return null;
  return value.split("").map((c) => Number(c));
}

function weighted(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += digits[i] * weights[i];
  return (sum % 11) % 10;
}

/** Контрольная сумма ИНН: 10 цифр (юрлицо) или 12 (ИП / самозанятый). */
export function isValidInn(inn: string): boolean {
  const d = digitsOf(inn.trim());
  if (!d) return false;
  if (d.length === 10) return weighted(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (d.length === 12) {
    return (
      weighted(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] &&
      weighted(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11]
    );
  }
  return false;
}

function modOfDigits(digits: number[], m: number): number {
  let r = 0;
  for (const digit of digits) r = (r * 10 + digit) % m;
  return r;
}

/** Контрольная сумма ОГРН (13 цифр) или ОГРНИП (15 цифр). */
export function isValidOgrn(ogrn: string): boolean {
  const d = digitsOf(ogrn.trim());
  if (!d) return false;
  if (d.length === 13) return modOfDigits(d.slice(0, 12), 11) % 10 === d[12];
  if (d.length === 15) return modOfDigits(d.slice(0, 14), 13) % 10 === d[14];
  return false;
}

/** Каких реквизитов не хватает (или они с ошибкой) для приёма оплаты. */
export function missingLegalFields(entity: LegalEntity): LegalField[] {
  const missing: LegalField[] = [];
  for (const field of Object.keys(LEGAL_ENV) as LegalField[]) {
    const value = entity[field];
    if (!value) {
      missing.push(field);
      continue;
    }
    if (field === "inn" && !isValidInn(value)) missing.push(field);
    if (field === "ogrn" && !isValidOgrn(value)) missing.push(field);
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) missing.push(field);
  }
  return missing;
}

export function isLegalInfoComplete(entity: LegalEntity = getLegalEntity()): boolean {
  return missingLegalFields(entity).length === 0;
}

/** Срок возврата товара надлежащего качества при дистанционной продаже (ЗоЗПП ст. 26.1). */
export const RETURN_DAYS_GOOD_QUALITY = 7;
/** Если сведения о возврате не были даны письменно при доставке, срок три месяца. */
export const RETURN_MONTHS_NO_NOTICE = 3;
/** Срок возврата денег после требования покупателя (ЗоЗПП ст. 26.1 п. 4). */
export const REFUND_DAYS = 10;
