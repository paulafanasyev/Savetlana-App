/**
 * Ссылки в ответах Светланы: «[Открыть форму резюме](/classifieds/new?…)».
 * Только страницы самого сайта (путь начинается с одного «/»), внешние ссылки
 * остаются обычным текстом. Для озвучки ссылка заменяется своей подписью,
 * чтобы Светлана не читала адрес вслух.
 */

export type ChatPart = { text: string } | { text: string; href: string };

const LINK = /\[([^\]\n]{1,80})\]\((\/(?!\/)[^\s()]{0,3000})\)/g;

export function splitChatLinks(text: string): ChatPart[] {
  const parts: ChatPart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ text: m[1], href: m[2] });
    last = index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function stripChatLinks(text: string): string {
  return text.replace(LINK, "$1");
}
