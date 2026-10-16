/**
 * Снять объявление с публикации и вернуть его. Возврат идёт через обычную
 * публикацию (publishClassified): та же антифрод-проверка и новый срок 30 дней.
 * Отклонённое модератором или скрытое площадкой так вернуть нельзя.
 */
import { prisma } from "../prisma";
import { UserFacingError } from "./engagement-rules";
import { audit } from "./audit";
import { publishClassified } from "./classifieds";
import { canClose, canReopen } from "../ad-status-rules";

async function ownAd(classifiedId: string, authorId: string) {
  const ad = await prisma.classified.findUnique({ where: { id: classifiedId }, select: { id: true, authorId: true, status: true } });
  if (!ad || ad.authorId !== authorId) throw new UserFacingError("Объявление не найдено", 404);
  return ad;
}

export async function closeClassified(classifiedId: string, authorId: string): Promise<void> {
  const ad = await ownAd(classifiedId, authorId);
  if (!canClose(ad.status)) throw new UserFacingError("Это объявление уже не опубликовано", 409);
  // Статус меняем, только если он ещё тот же: модератор мог успеть его поменять.
  const res = await prisma.classified.updateMany({ where: { id: ad.id, status: ad.status }, data: { status: "CLOSED" } });
  if (res.count === 0) throw new UserFacingError("Объявление только что изменилось, обновите страницу", 409);
  await audit({
    actorId: authorId,
    actorRole: "BUYER",
    action: "classified.closed",
    targetType: "Classified",
    targetId: ad.id,
    before: { status: ad.status },
    after: { status: "CLOSED" },
  });
}

/** Вернуть снятое объявление. Возвращает новый статус: опубликовано или на проверке. */
export async function reopenClassified(classifiedId: string, authorId: string): Promise<string> {
  const ad = await ownAd(classifiedId, authorId);
  if (!canReopen(ad.status)) throw new UserFacingError("Вернуть можно только объявление, которое вы сняли сами", 409);
  const updated = await publishClassified(ad.id, authorId);
  return updated.status;
}
