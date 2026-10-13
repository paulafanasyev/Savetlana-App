/**
 * Что нужно товару, чтобы его можно было опубликовать: цена, хотя бы одно фото
 * и ненулевой остаток. Иначе покупатель увидит карточку, которую нельзя купить.
 */
import type { Prisma } from "@prisma/client";

type Db = Pick<Prisma.TransactionClient, "product" | "productImage" | "inventory">;

export async function publishProblems(db: Db, productId: string): Promise<string[]> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { priceKopecks: true } });
  if (!product) return ["товар не найден"];
  const images = await db.productImage.count({ where: { productId } });
  const inventory = await db.inventory.findUnique({ where: { productId }, select: { quantity: true } });
  const problems: string[] = [];
  if (!product.priceKopecks || product.priceKopecks < 100) problems.push("укажите цену от 1 ₽");
  if (images === 0) problems.push("добавьте хотя бы одно фото");
  if (!inventory || inventory.quantity <= 0) problems.push("укажите остаток на складе");
  return problems;
}

export function publishProblemsMessage(problems: string[]): string {
  return `Перед публикацией ${problems.join(", ")}.`;
}
