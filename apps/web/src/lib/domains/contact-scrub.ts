/**
 * Личные контакты из текста резюме, которое увидят все: телефон, почта,
 * мессенджеры, паспорт и СНИЛС. Номер в открытом объявлении собирают
 * спамеры и мошенники («работодатель» звонит и просит код из СМС или фото
 * паспорта). На площадке работодатель пишет соискателю через сообщения,
 * поэтому контакты в тексте не нужны. Чистые правила без сети и базы.
 */

export type ContactKind = "phone" | "email" | "messenger" | "passport" | "snils";

/** Подпись перед контактом, которая без него теряет смысл: «тел.:», «пишите в телеграм». */
const LABEL =
  "(?:(?:мой|мои|моя|наш)\\s+)?(?:(?:контакты|контактный\\s+телефон|телефон|тел|моб|номер|звоните|звонить|пишите|писать|связь|для\\s+связи|whatsapp|ватсап|вотсап|telegram|телеграм|тг|viber|вайбер|почта|e-?mail|email)\\.?(?:\\s+(?:в|по|на))?\\s*(?:whatsapp|ватсап|вотсап|telegram|телеграм|тг|viber|вайбер)?\\s*[:\\-–—]?\\s*)*";

const RULES: { kind: ContactKind; re: RegExp }[] = [
  // Паспорт: «паспорт 45 12 345678», «паспорт серия 4512 номер 345678».
  { kind: "passport", re: /паспорт\S*\s*(?:рф\s*)?(?:серия\s*)?\d{2}\s?\d{2}\s*(?:№|номер|n)?\s*\d{6}(?!\d)/gi },
  // СНИЛС: 123-456-789 01.
  { kind: "snils", re: /(?:снилс\s*[:\-–—]?\s*)?(?<!\d)\d{3}-\d{3}-\d{3}[\s-]\d{2}(?!\d)/gi },
  { kind: "email", re: new RegExp(`${LABEL}[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}`, "gi") },
  { kind: "messenger", re: new RegExp(`${LABEL}(?:https?:\\/\\/)?(?:t\\.me|wa\\.me|vk\\.me|vk\\.com|telegram\\.me)\\/[^\\s,;]+`, "gi") },
  { kind: "messenger", re: new RegExp(`${LABEL}(?<![a-z0-9._%+-])@[a-z0-9_]{5,32}(?![a-z0-9_])`, "gi") },
  // Телефон: +7 / 8 / 7 и десять цифр или мобильный без кода страны (9xx…).
  { kind: "phone", re: new RegExp(`${LABEL}(?<![\\d@])(?:(?:\\+7|8|7)[\\s\\-()]*\\d{3}|\\(?9\\d{2}\\)?)[\\s\\-()]*\\d{3}[\\s\\-]*\\d{2}[\\s\\-]*\\d{2}(?!\\d)`, "gi") },
];

const ORDER: ContactKind[] = ["phone", "email", "messenger", "passport", "snils"];

const LABELS: Record<ContactKind, string> = {
  phone: "телефон",
  email: "почту",
  messenger: "контакт в мессенджере",
  passport: "паспортные данные",
  snils: "СНИЛС",
};

export function scrubContacts(raw: string): { text: string; removed: ContactKind[] } {
  const removed: ContactKind[] = [];
  let text = raw;
  for (const { kind, re } of RULES) {
    text = text.replace(re, () => {
      if (!removed.includes(kind)) removed.push(kind);
      return " ";
    });
  }
  if (!removed.length) return { text: raw, removed };
  removed.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    // Союз, который остался между убранными контактами: «звоните … или пишите …».
    .replace(/(?:[,\s]+(?:или|либо|и|а также))+\s*(?=[,.;!?]|$)/gim, "")
    .replace(/^[ \t,.;:!?—–-]+|[ \t,;:—–-]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, removed };
}

/** «телефон и почту», «телефон, почту и СНИЛС». */
export function describeRemoved(removed: ContactKind[]): string {
  const words = removed.map((k) => LABELS[k]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} и ${words[words.length - 1]}`;
}

/** Что сказать соискателю, если контакты убраны. */
export function removedNote(removed: ContactKind[]): string | null {
  if (!removed.length) return null;
  return `Убрала из текста ${describeRemoved(removed)}: объявление видят все, а такие данные собирают мошенники. Работодатели напишут вам через сообщения на сайте.`;
}
