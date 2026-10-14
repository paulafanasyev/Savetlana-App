/**
 * Массовая публикация черновиков продавца. Публикуются только карточки,
 * которые прошли ту же проверку, что и одиночная публикация (цена, фото,
 * остаток). Остальные остаются черновиками, и продавец видит, чего им не хватает.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { problemsOf, publishProblems } from "./publish-check";

export const PUBLISH_ALL_MAX = 300;

export interface DraftCheck {
  productId: string;
  title: string;
  problems: string[];
}

export interface PublishPlan {
  drafts: number;
  ready: DraftCheck[];
  blocked: DraftCheck[];
  /** Черновиков больше лимита: остальные попадут в следующий заход. */
  more: boolean;
}

export async function planDraftPublish(sellerId: string): Promise<PublishPlan> {
  const where = { sellerId, status: "DRAFT" as const };
  const [drafts, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: { id: true, title: true, priceKopecks: true, inventory: { select: { quantity: true } }, _count: { select: { images: true } } },
      orderBy: { updatedAt: "desc" },
      take: PUBLISH_ALL_MAX,
    }),
  ]);
  const ready: DraftCheck[] = [];
  const blocked: DraftCheck[] = [];
  for (const row of rows) {
    const problems = problemsOf({ priceKopecks: row.priceKopecks, imageCount: row._count.images, quantity: row.inventory?.quantity });
    (problems.length ? blocked : ready).push({ productId: row.id, title: row.title, problems });
  }
  return { drafts, ready, blocked, more: drafts > rows.length };
}

export interface PublishOutcome {
  published: number;
  skipped: DraftCheck[];
}

/**
 * Публикует перечисленные черновики. Каждый товар проверяется заново внутри
 * своей транзакции: если с момента просмотра у него пропало фото или остаток,
 * или его уже опубликовали в другой вкладке, он будет пропущен, а не сломан.
 */
export async function publishDrafts(input: { sellerId: string; actorId: string; productIds: string[] }): Promise<PublishOutcome> {
  const ids = [...new Set(input.productIds.filter((id) => typeof id === "string" && id.length > 0))].slice(0, PUBLISH_ALL_MAX);
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, sellerId: input.sellerId },
    select: { id: true, title: true },
  });
  const titles = new Map(products.map((p) => [p.id, p.title]));
  const skipped: DraftCheck[] = [];
  const published: string[] = [];
  for (const id of ids) {
    const title = titles.get(id);
    if (!title) {
      skipped.push({ productId: id, title: "неизвестный товар", problems: ["товар не найден в вашем каталоге"] });
      continue;
    }
    const outcome = await prisma.$transaction(async (tx) => {
      const problems = await publishProblems(tx, id);
      if (problems.length) return problems;
      const now = new Date();
      const switched = await tx.product.updateMany({ where: { id, sellerId: input.sellerId, status: "DRAFT" }, data: { status: "ACTIVE" } });
      if (switched.count === 0) return ["товар уже не черновик"];
      await tx.listing.upsert({
        where: { productId: id },
        create: { productId: id, publishedAt: now, isLive: true },
        update: { publishedAt: now, isLive: true },
      });
      await tx.listingHistory.create({
        data: { productId: id, sellerId: input.sellerId, action: "PUBLISHED", actorId: input.actorId, change: JSON.stringify({ bulk: true }), note: "массовая публикация" },
      });
      return null;
    });
    if (outcome) skipped.push({ productId: id, title, problems: outcome });
    else published.push(id);
  }
  if (published.length) {
    await audit({
      actorId: input.actorId,
      actorRole: "seller",
      action: "product.bulk_published",
      targetType: "seller",
      targetId: input.sellerId,
      after: { published: published.length, skipped: skipped.length, productIds: published.slice(0, 50) },
    });
  }
  return { published: published.length, skipped };
}

/** Понятная причина, почему продавцу пока нельзя публиковать, или null. */
export function publishGateReason(gate: { active: boolean; blockers: readonly string[]; nextStep?: string | null }): string | null {
  if (gate.active) return null;
  return `Публиковать товары можно после проверки магазина: ${gate.blockers.join(", ")}. Следующий шаг: ${gate.nextStep ?? "завершите верификацию"}.`;
}
