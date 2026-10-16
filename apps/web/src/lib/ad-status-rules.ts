/**
 * Что автор может сделать со своим объявлением сам, без модератора.
 * Снять: опубликованное или ждущее проверки. Вернуть: только снятое самим автором
 * (отклонённое модератором и скрытое площадкой так вернуть нельзя).
 */
export function canClose(status: string): boolean {
  return status === "PUBLISHED" || status === "MODERATION";
}

export function canReopen(status: string): boolean {
  return status === "CLOSED" || status === "SOLD";
}

/** Куда вернуть человека после действия: только два фиксированных адреса, чужие ссылки не принимаем. */
export function backPath(classifiedId: string, back: string | null): string {
  return back === "ad" ? `/classifieds/${encodeURIComponent(classifiedId)}` : "/classifieds/my";
}
