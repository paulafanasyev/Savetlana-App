import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { CatalogImport } from "@/components/CatalogImport";

export const dynamic = "force-dynamic";

export default async function SellerCatalogImportPage() {
  await requireSellerServer();
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Перенос товаров</h1>
          <p className="mt-1 text-sm text-ink-soft">Загрузите файл из Ozon, Wildberries, 1С или фид YML, и товары появятся в вашем магазине черновиками.</p>
        </div>
        <Link href="/seller/products" className="btn btn-ghost">К товарам</Link>
      </div>
      <CatalogImport />
    </main>
  );
}
