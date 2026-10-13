import { notFound } from "next/navigation";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureBaseCategories } from "@/lib/domains/categories";
import { ProductEditor } from "@/components/ProductEditor";

export const dynamic = "force-dynamic";

export default async function SellerProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { sellerId } = await requireSellerServer();
  const { id } = await params;
  await ensureBaseCategories();
  const [product, categories] = await Promise.all([
    prisma.product.findFirst({ where: { id, sellerId }, include: { inventory: true, images: { orderBy: { position: "asc" } } } }),
    prisma.category.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Редактирование товара</h1>
      <ProductEditor product={product} categories={categories} />
    </main>
  );
}
