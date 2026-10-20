/**
 * Подсказки к ИНН и ОГРН в форме заявки продавца: ошибку в цифрах видно сразу, до
 * отправки, и заявка не возвращается из-за опечатки. Те же контрольные суммы, что и
 * на сервере (lib/legal.ts). null: всё в порядке.
 */
import { isValidInn, isValidOgrn } from "./legal";

/** Убираем пробелы и дефисы: ИНН часто вставляют из документа с разбивкой. */
export function cleanDigits(value: string): string {
  return value.replace(/[\s\u00a0-]/g, "");
}

export function innHint(raw: string, sellerType: string): string | null {
  const v = cleanDigits(raw);
  if (!v) return "Укажите ИНН";
  if (!/^\d+$/.test(v)) return "В ИНН только цифры";
  const company = sellerType === "COMPANY";
  const need = company ? 10 : 12;
  if (v.length !== need) {
    const who = company ? "организации" : sellerType === "IP" ? "ИП" : "самозанятого";
    return `ИНН ${who} состоит из ${need} цифр, сейчас введено ${v.length}`;
  }
  if (!isValidInn(v)) return "В ИНН опечатка: контрольные цифры не сходятся, сверьте номер с документом";
  return null;
}

export function ogrnHint(raw: string, sellerType: string): string | null {
  if (sellerType !== "IP" && sellerType !== "COMPANY") return null;
  const label = sellerType === "IP" ? "ОГРНИП" : "ОГРН";
  const need = sellerType === "IP" ? 15 : 13;
  const v = cleanDigits(raw);
  if (!v) return `Укажите ${label}`;
  if (!/^\d+$/.test(v)) return `В ${label} только цифры`;
  if (v.length !== need) return `${label} состоит из ${need} цифр, сейчас введено ${v.length}`;
  if (!isValidOgrn(v)) return `В ${label} опечатка: контрольная цифра не сходится, сверьте номер с выпиской`;
  return null;
}
