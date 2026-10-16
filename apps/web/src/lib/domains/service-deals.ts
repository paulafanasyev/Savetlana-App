/**
 * Безопасная сделка для услуг: заказчик выбрал исполнителя → создаётся
 * заказ на сумму предложения → заказчик оплачивает (деньги у площадки) →
 * исполнитель сдаёт работу → заказчик принимает (или автоприёмка через
 * 7 дней) → деньги доступны исполнителю. Приёмка, автоприёмка, спор и
 * выплата те же, что у товаров (safe-deal-actions.ts, seller-payouts.ts).
 *
 * Деньги исполнителю начисляются на его профиль продавца: если профиля нет,
 * он создаётся неактивным. Вывести деньги можно после проверки и реквизитов,
 * как у любого продавца.
 */
import { prisma } from "../prisma";
import { generateOrderNumber } from "../utils";
import { computeSettlement } from "./payments";
import { notify } from "./notifications";
import { transitionOrder } from "./orders";
import { UserFacingError } from "./engagement-rules";
import { ACCEPT_DAYS } from "../safe-deal";
import { WORK_SUBMIT_FROM, cleanWorkReport, serviceAddress, serviceGroupKey, serviceMeta, type ServiceMeta } from "../service-deal";

/** Профиль, на который исполнителю начисляются деньги. */
export async function ensurePerformerProfile(userId: string): Promise<string> {
  const existing = await prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  try {
    const created = await prisma.sellerProfile.create({
      data: { userId, slug: `p-${userId}`, displayName: user.name?.trim() || "Исполнитель", sellerType: "INDIVIDUAL" },
      select: { id: true },
    });
    return created.id;
  } catch {
    const again = await prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (again) return again.id;
    throw new UserFacingError("Не удалось подготовить профиль исполнителя, попробуйте ещё раз", 500);
  }
}

export interface ServiceDeal {
  id: string;
  number: string;
  status: string;
  buyerId: string;
  totalKopecks: number;
  performerUserId: string;
  meta: ServiceMeta;
}

/** Сделка по объявлению (не больше одной). */
export async function serviceOrderForAd(classifiedId: string): Promise<ServiceDeal | null> {
  const group = await prisma.orderGroup.findUnique({
    where: { idempotencyKey: serviceGroupKey(classifiedId) },
    select: {
      orders: {
        take: 1,
        select: { id: true, number: true, status: true, buyerId: true, totalKopecks: true, deliveryAddress: true, sellerProfile: { select: { userId: true } } },
      },
    },
  });
  const order = group?.orders[0];
  if (!order) return null;
  const meta = serviceMeta(order.deliveryAddress);
  if (!meta) return null;
  return { id: order.id, number: order.number, status: order.status, buyerId: order.buyerId, totalKopecks: order.totalKopecks, performerUserId: order.sellerProfile.userId, meta };
}

/**
 * Заказ услуги по выбранному предложению. Ключ группы уникален для объявления,
 * поэтому два одновременных нажатия «Выбрать» не создадут две сделки.
 */
export async function createServiceOrder(input: {
  classifiedId: string;
  title: string;
  customerId: string;
  performerId: string;
  priceKopecks: number;
  days: number;
}): Promise<{ id: string; number: string }> {
  const sellerId = await ensurePerformerProfile(input.performerId);
  const settlement = computeSettlement({ grossKopecks: input.priceKopecks });
  try {
    return await prisma.$transaction(async (tx) => {
      const group = await tx.orderGroup.create({
        data: { buyerId: input.customerId, idempotencyKey: serviceGroupKey(input.classifiedId), totalKopecks: input.priceKopecks },
      });
      const order = await tx.order.create({
        data: {
          groupId: group.id,
          buyerId: input.customerId,
          sellerId,
          number: generateOrderNumber(),
          status: "PAYMENT_PENDING",
          subtotalKopecks: input.priceKopecks,
          deliveryKopecks: 0,
          platformFeeKopecks: settlement.platformFeeKopecks,
          paymentFeeKopecks: settlement.paymentFeeKopecks,
          totalKopecks: input.priceKopecks,
          deliveryAddress: serviceAddress({ classifiedId: input.classifiedId, performerId: input.performerId, days: input.days, title: input.title }),
          note: `Услуга: ${input.title.slice(0, 120)}`,
        },
        select: { id: true, number: true },
      });
      await tx.orderHistory.create({ data: { orderId: order.id, toStatus: "CREATED", reason: "исполнитель выбран", actorId: input.customerId } });
      await tx.orderHistory.create({ data: { orderId: order.id, fromStatus: "CREATED", toStatus: "PAYMENT_PENDING", reason: "ждём оплату", actorId: input.customerId } });
      return order;
    });
  } catch (e) {
    if (await serviceOrderForAd(input.classifiedId)) throw new UserFacingError("Исполнитель по этому заказу уже выбран", 409);
    throw e;
  }
}

/** Исполнитель сдаёт работу: заказ «Сдан», заказчику уходит отчёт. */
export async function submitWork(orderId: string, performerUserId: string, raw: unknown): Promise<{ number: string }> {
  const report = cleanWorkReport(raw);
  if (!report.ok) throw new UserFacingError(report.error, 400);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, status: true, buyerId: true, sellerId: true, deliveryAddress: true, sellerProfile: { select: { userId: true } } },
  });
  if (!order || !serviceMeta(order.deliveryAddress)) throw new UserFacingError("Сделка не найдена", 404);
  if (order.sellerProfile.userId !== performerUserId) throw new UserFacingError("Сдать работу может только исполнитель этой сделки", 403);
  if (!WORK_SUBMIT_FROM.includes(order.status)) {
    throw new UserFacingError(
      order.status === "PAYMENT_PENDING" || order.status === "CREATED" ? "Заказчик ещё не оплатил заказ: сдать работу можно после оплаты" : "Работа уже сдана или сделка закрыта",
      409
    );
  }
  try {
    await transitionOrder({
      orderId: order.id,
      to: "DELIVERED",
      note: `работа сдана: ${report.text}`,
      actorId: performerUserId,
      actorRole: "seller",
      actingSellerId: order.sellerId,
      onlyFrom: WORK_SUBMIT_FROM,
    });
  } catch {
    throw new UserFacingError("Статус сделки уже изменился, обновите страницу", 409);
  }
  await notify({
    userId: order.buyerId,
    kind: "order_status",
    title: `Исполнитель сдал работу по заказу ${order.number}`,
    body: `${report.text.slice(0, 300)}\n\nПроверьте результат и нажмите «Работа принята». Деньги у площадки; если не открыть спор, они уйдут исполнителю через ${ACCEPT_DAYS} дней.`,
    url: `/orders/${order.id}`,
  }).catch(() => undefined);
  return { number: order.number };
}
