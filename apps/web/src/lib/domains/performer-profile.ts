/**
 * Данные для публичного профиля исполнителя. Только счётчики, опубликованные
 * услуги и отзывы заказчиков (без имён): ни почты, ни телефона, ни сумм чужих заказов.
 */
import { prisma } from "../prisma";
import { SERVICE_ADDRESS_PREFIX } from "../service-deal";
import { BID_MARK } from "../freelance-bids";
import { isPerformer, type PerformerStats } from "../performer-profile";
import { listServiceReviews, type ServiceReviewView } from "./service-reviews";

export interface PerformerOffer {
  id: string;
  title: string;
  priceKopecks: number;
  city: string | null;
}

export interface PerformerView {
  id: string;
  name: string;
  since: Date;
  npdStatus: string | null;
  identityStatus: string | null;
  stats: PerformerStats;
  offers: PerformerOffer[];
  /** Все оценки (для средней) и последние отзывы для показа. */
  ratings: number[];
  reviews: ServiceReviewView[];
}

export async function loadPerformer(userId: string): Promise<PerformerView | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(userId)) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, createdAt: true, isBlocked: true, sellerProfile: { select: { id: true, npdStatus: true, identityStatus: true } } },
  });
  if (!user || user.isBlocked) return null;
  const sellerId = user.sellerProfile?.id ?? null;
  const service = { startsWith: SERVICE_ADDRESS_PREFIX };
  const [completed, inWork, disputed, bids, offers, reviews] = await Promise.all([
    sellerId ? prisma.order.count({ where: { sellerId, deliveryAddress: service, status: "COMPLETED" } }) : Promise.resolve(0),
    sellerId ? prisma.order.count({ where: { sellerId, deliveryAddress: service, status: { in: ["PAID", "CONFIRMED", "DELIVERED"] } } }) : Promise.resolve(0),
    sellerId ? prisma.order.count({ where: { sellerId, deliveryAddress: service, status: { in: ["DISPUTED", "RETURN_REQUESTED", "RETURNING"] } } }) : Promise.resolve(0),
    prisma.notification.count({ where: { kind: "classified_reply", url: { endsWith: `/replies/${user.id}` }, body: { startsWith: BID_MARK } } }),
    prisma.classified.findMany({
      where: { authorId: user.id, vertical: "SERVICE", status: "PUBLISHED", NOT: { dealType: "SERVICE_REQUEST" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, priceKopecks: true, city: { select: { name: true } } },
    }),
    listServiceReviews(user.id),
  ]);
  const stats = { completed, inWork, disputed, bids };
  if (!isPerformer(stats, offers.length)) return null;
  return {
    id: user.id,
    name: user.name?.trim() || "Исполнитель",
    since: user.createdAt,
    npdStatus: user.sellerProfile?.npdStatus ?? null,
    identityStatus: user.sellerProfile?.identityStatus ?? null,
    stats,
    offers: offers.map((o) => ({ id: o.id, title: o.title, priceKopecks: o.priceKopecks, city: o.city?.name ?? null })),
    ratings: reviews.map((r) => r.rating),
    reviews: reviews.slice(0, 30),
  };
}
