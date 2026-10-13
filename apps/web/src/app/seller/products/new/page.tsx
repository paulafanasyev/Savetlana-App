import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureBaseCategories } from "@/lib/domains/categories";
import { ProductDraftAssistant } from "@/components/ProductDraftAssistant";

export const dynamic = "force-dynamic";

/** Отдельная страница «Новый товар»: на неё ведут кнопки «Добавить товар». */
export default async function NewSellerProductPage() {
  await requireSellerServer();
  await ensureBaseCategories();
  const categories = await prisma.category.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Новый товар</h1>
          <p className="text-sm text-ink-soft">Сначала создаётся черновик: покупатели его не видят, пока вы не опубликуете карточку.</p>
        </div>
        <Link href="/seller/products" className="btn btn-ghost">Все товары</Link>
      </div>
      <ProductDraftAssistant categories={categories} afterPublishHref="/seller/products" />
      <section className="card space-y-2 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-semibold text-ink">Чтобы товар хорошо продавался</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Три и больше фотографий на светлом фоне, первая самая понятная.</li>
          <li>Описание от 100 знаков: размеры, материал, комплектация, для кого товар.</li>
          <li>Ключевые слова, по которым вас будут искать: «чайник, электрочайник, стеклянный».</li>
          <li>После создания укажите остаток на странице редактирования, без него опубликовать нельзя.</li>
        </ul>
      </section>
    </main>
  );
}
