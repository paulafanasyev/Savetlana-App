/**
 * Продление объявления автором на 30 дней. Текст не меняется, поэтому повторная
 * проверка не нужна; дата публикации прежняя, так что поднять объявление выше
 * других продлением нельзя.
 */
import { prisma } from "../prisma";
import { UserFacingError } from "./engagement-rules";
import { audit } from "./audit";
import { canRenew, renewedUntil } from "../ad-active";

export async function renewClassified(classifiedId: string, authorId: string): Promise<Date> {
  const ad = await prisma.classified.findUnique({ where: { id: classifiedId }, select: { id: true, authorId: true, status: true, expiresAt: true } });
  if (!ad || ad.authorId !== authorId) throw new UserFacingError("Объявление не найдено", 404);
  if (ad.status !== "PUBLISHED") throw new UserFacingError("Продлить можно только опубликованное объявление", 409);
  const now = new Date();
  if (!canRenew(ad.expiresAt, now)) throw new UserFacingError("Продлить можно за 3 дня до конца срока", 409);
  const until = renewedUntil(ad.expiresAt, now);
  await prisma.classified.update({ where: { id: ad.id }, data: { expiresAt: until } });
  await audit({
    actorId: authorId,
    actorRole: "BUYER",
    action: "classified.renewed",
    targetType: "Classified",
    targetId: ad.id,
    before: { expiresAt: ad.expiresAt },
    after: { expiresAt: until },
  });
  return until;
}
