/**
 * Фриланс: исполнитель предлагает цену и срок по заказу услуги, заказчик
 * сравнивает предложения и выбирает исполнителя. Предложение идёт тем же путём,
 * что и отклик (лимиты, антифрод, уведомление автору). Выбор исполнителя
 * создаёт безопасную сделку (service-deals.ts): заказ на сумму предложения,
 * который заказчик оплачивает на площадке.
 */
import { prisma } from "../prisma";
import { UserFacingError } from "./engagement-rules";
import { notify } from "./notifications";
import { adForReply, applicantThreadUrl, sendToAuthor } from "./classified-replies";
import { createServiceOrder, serviceOrderForAd } from "./service-deals";
import { BID_MARK, CHOSEN_MARK, NOT_CHOSEN_MARK, bidBody, daysText, isBidAd, latestBids, parseBidInput, rubPlain, type Bid } from "../freelance-bids";

/** Кто выбран: сначала по сделке, для старых выборов без сделки: по сообщению. */
async function chosenApplicantId(classifiedId: string): Promise<string | null> {
  const deal = await serviceOrderForAd(classifiedId);
  if (deal) return deal.meta.performerId;
  const row = await prisma.notification.findFirst({
    where: { kind: "classified_answer", url: applicantThreadUrl(classifiedId), body: { startsWith: CHOSEN_MARK } },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

/** Исполнитель предлагает цену и срок. Новое предложение заменяет прежнее. */
export async function sendBid(
  sender: { id: string; name: string | null },
  classifiedId: string,
  input: { price?: unknown; days?: unknown; text?: unknown }
): Promise<void> {
  const ad = await adForReply(classifiedId);
  if (!isBidAd(ad)) throw new UserFacingError("Предложить цену и срок можно только по заказу услуги", 400);
  const parsed = parseBidInput(input);
  if (!parsed.ok) throw new UserFacingError(parsed.error, 400);
  if (await chosenApplicantId(ad.id)) throw new UserFacingError("Заказчик уже выбрал исполнителя, предложения больше не принимаются", 409);
  await sendToAuthor(sender, classifiedId, bidBody(parsed.bid));
}

export interface BidView extends Bid {
  name: string;
  chosen: boolean;
}

/** Предложения по заказу: последнее от каждого исполнителя. */
export async function listBids(ad: { id: string; authorId: string }): Promise<{ bids: BidView[]; chosenId: string | null }> {
  const prefix = `/classifieds/${ad.id}/replies/`;
  const rows = await prisma.notification.findMany({
    where: { userId: ad.authorId, kind: "classified_reply", url: { startsWith: prefix }, body: { startsWith: BID_MARK } },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { url: true, body: true, createdAt: true },
  });
  const bids = latestBids(
    rows
      .map((r) => ({ applicantId: (r.url ?? "").slice(prefix.length), body: r.body, createdAt: r.createdAt }))
      .filter((r) => r.applicantId)
  );
  const chosenId = await chosenApplicantId(ad.id);
  const users = await prisma.user.findMany({ where: { id: { in: bids.map((b) => b.applicantId) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name?.trim() || "Без имени"]));
  return {
    bids: bids
      .filter((b) => names.has(b.applicantId))
      .map((b) => ({ ...b, name: names.get(b.applicantId) as string, chosen: b.applicantId === chosenId })),
    chosenId,
  };
}

/**
 * Заказчик выбирает исполнителя: создаётся безопасная сделка на сумму
 * предложения. Остальные исполнители получают честное уведомление.
 */
export async function chooseBid(authorId: string, classifiedId: string, applicantId: string): Promise<{ orderId: string; priceKopecks: number; days: number }> {
  const ad = await adForReply(classifiedId);
  if (ad.authorId !== authorId) throw new UserFacingError("Выбрать исполнителя может только автор заказа", 403);
  if (!isBidAd(ad)) throw new UserFacingError("Исполнителя выбирают только по заказу услуги", 400);
  const { bids, chosenId } = await listBids(ad);
  if (chosenId) throw new UserFacingError(chosenId === applicantId ? "Этот исполнитель уже выбран" : "Исполнитель по этому заказу уже выбран", 409);
  const bid = bids.find((b) => b.applicantId === applicantId);
  if (!bid) throw new UserFacingError("Предложение этого исполнителя не найдено", 404);
  // Сделка создаётся первой: если другое нажатие успело раньше, здесь будет отказ.
  const order = await createServiceOrder({
    classifiedId: ad.id,
    title: ad.title,
    customerId: authorId,
    performerId: applicantId,
    priceKopecks: bid.priceKopecks,
    days: bid.days,
  });
  const url = applicantThreadUrl(ad.id);
  const title = ad.title.slice(0, 80);
  await notify({
    userId: applicantId,
    kind: "classified_answer",
    title: `Вас выбрали исполнителем: «${title}»`,
    body: `${CHOSEN_MARK} по заказу «${title}» за ${rubPlain(bid.priceKopecks)}, срок ${daysText(bid.days)}. Сделка безопасная: заказчик оплачивает на площадке, деньги хранятся у нас и придут вам после приёмки работы. Не начинайте, пока заказ не оплачен: статус видно в этой переписке.`,
    url,
  });
  await notify({
    userId: authorId,
    kind: "order_status",
    title: `Оплатите заказ ${order.number}`,
    body: `Исполнитель выбран: ${rubPlain(bid.priceKopecks)}, срок ${daysText(bid.days)}. Деньги будут храниться у площадки, пока вы не примете работу.`,
    url: `/orders/${order.id}`,
  }).catch(() => undefined);
  for (const other of bids.filter((b) => b.applicantId !== applicantId).slice(0, 100)) {
    await notify({
      userId: other.applicantId,
      kind: "classified_answer",
      title: `Заказ «${title}»: выбран другой исполнитель`,
      body: `${NOT_CHOSEN_MARK}. Спасибо за предложение! Другие заказы есть в разделе «Объявления», Услуги.`,
      url,
    }).catch(() => undefined);
  }
  return { orderId: order.id, priceKopecks: bid.priceKopecks, days: bid.days };
}
