/**
 * Что автор может сделать со своим объявлением сам, без модератора.
 * Снять: опубликованное или ждущее проверки. Вернуть: только снятое самим автором
 * (отклонённое модератором и скрытое площадкой так вернуть нельзя).
 * При снятии автор может отметить, что сделка состоялась (статус SOLD): так площадка
 * честно видит, сколько объявлений заканчивается сделкой.
 */
export function canClose(status: string): boolean {
  return status === "PUBLISHED" || status === "MODERATION";
}

export function canReopen(status: string): boolean {
  return status === "CLOSED" || status === "SOLD";
}

export type CloseOutcome = "deal" | "closed";

/** Итог из формы: только два значения, всё прочее считаем простым снятием. */
export function closeOutcome(raw: string | null): CloseOutcome {
  return raw === "deal" ? "deal" : "closed";
}

export function closeStatus(outcome: CloseOutcome): "SOLD" | "CLOSED" {
  return outcome === "deal" ? "SOLD" : "CLOSED";
}

/** Куда вернуть человека после действия: только два фиксированных адреса, чужие ссылки не принимаем. */
export function backPath(classifiedId: string, back: string | null): string {
  return back === "ad" ? `/classifieds/${encodeURIComponent(classifiedId)}` : "/classifieds/my";
}
