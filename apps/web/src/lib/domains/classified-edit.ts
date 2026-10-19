/**
 * Редактирование объявления автором. Новый текст проходит ту же антифрод-проверку,
 * что и новое объявление: опасное не сохраняется, подозрительное уходит модератору.
 * Иначе мошенник размещал бы чистое объявление, а потом дописывал «предоплата на карту».
 * В резюме контакты и документы убираются так же, как при размещении.
 */
import { prisma } from "../prisma";
import { readObject, writeJson } from "../db/json";
import { UserFacingError } from "./engagement-rules";
import { audit } from "./audit";
import { recordSentToModeration, rejectIfBlocked, screenClassified } from "./classified-screening";
import { scrubResumeListing } from "./contact-scrub";
import { parseAttrs } from "../classified-fields";
import { canEdit, mergeAttrs, priceFromRub } from "../ad-edit";

export interface EditInput {
  title: string;
  description: string;
  priceRub: unknown;
  /** Чтение полей характеристик из формы (attr_…). */
  get: (name: string) => unknown;
}

/** Сохранить правку. Возвращает статус после неё: опубликовано или на проверке. */
export async function editClassified(classifiedId: string, authorId: string, input: EditInput): Promise<string> {
  const ad = await prisma.classified.findUnique({ where: { id: classifiedId }, include: { images: true } });
  if (!ad || ad.authorId !== authorId) throw new UserFacingError("Объявление не найдено", 404);
  if (!canEdit(ad.status)) throw new UserFacingError("Редактировать можно опубликованное объявление или ожидающее проверки", 409);

  const priceKopecks = priceFromRub(input.priceRub);
  if (priceKopecks === null) throw new UserFacingError("Цена указана неверно: напишите число в рублях или оставьте поле пустым");
  const cleaned = scrubResumeListing({
    vertical: ad.vertical,
    dealType: ad.dealType,
    title: input.title.trim().slice(0, 200),
    description: input.description.slice(0, 5000),
  });
  const title = cleaned.title.trim();
  if (title.length < 5) throw new UserFacingError("Заголовок должен быть не короче 5 символов");
  const description = cleaned.description?.trim() || null;
  const attrs = mergeAttrs(ad.vertical, readObject(ad.attrs), parseAttrs(ad.vertical, input.get));

  const screening = await screenClassified({
    authorId,
    cityId: ad.cityId,
    vertical: ad.vertical,
    dealType: ad.dealType,
    title,
    description,
    category: ad.category,
    priceKopecks,
    attrs,
    images: ad.images.map((i) => i.url),
    excludeId: ad.id,
  });
  await rejectIfBlocked(authorId, screening);
  const status = screening.verdict === "review" ? "MODERATION" : ad.status;

  await prisma.classified.update({
    where: { id: ad.id },
    data: { title, description, priceKopecks, attrs: writeJson(attrs), status },
  });
  if (status === "MODERATION" && ad.status !== "MODERATION") await recordSentToModeration(authorId, ad.id, screening);
  await audit({
    actorId: authorId,
    actorRole: "BUYER",
    action: "classified.edited",
    targetType: "Classified",
    targetId: ad.id,
    before: { title: ad.title, priceKopecks: ad.priceKopecks, status: ad.status },
    after: { title, priceKopecks, status },
  });
  return status;
}
