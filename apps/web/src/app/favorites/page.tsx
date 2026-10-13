import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { listFavorites, getOrCreateWishlist, listWishlistItems } from "@/lib/domains/collections";
import { rub, availabilityLabel } from "@/lib/format";
import { AddToCartButton } from "@/components/AddToCartButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WishlistRemoveButton } from "@/components/WishlistRemoveButton";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const { user } = await requireUserServer();
  const [favorites, wishlist] = await Promise.all([
    listFavorites(user.id),
    getOrCreateWishlist(user.id),
  ]);
  const wishlistItems = await listWishlistItems(wishlist.id, user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-ink">Избранное и списки желаний</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Всё, что вы сохранили. Это используется для рекомендаций, и это можно
        очистить в любое время в разделе «Конфиденциальность».
      </p>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-bold text-ink">
          Избранное <span className="text-ink-faint">({favorites.length})</span>
        </h2>
        {favorites.length === 0 ? (
          <div className="card p-6 text-sm text-ink-soft">
            Здесь будут товары, которые вы отметите звёздочкой.{" "}
            <Link href="/catalog" className="text-svetlana-700 hover:underline">
              Перейти в каталог
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {favorites.map((p) => (
              <ProductCard key={p.id} id={p.id} title={p.title} priceKopecks={p.priceKopecks} availability={p.availability} quantity={p.quantity ?? null} hasVariants={p.hasVariants === true} sellerName={p.sellerName} imageUrl={p.imageUrl} favorite />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-bold text-ink">
          Список «{wishlist.name}» <span className="text-ink-faint">({wishlistItems.length})</span>
        </h2>
        {wishlistItems.length === 0 ? (
          <div className="card p-6 text-sm text-ink-soft">
            В этот список можно собрать товары для повтора покупки или подарков.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {wishlistItems.map((p) => (
              <ProductCard key={p.id} id={p.id} title={p.title} priceKopecks={p.priceKopecks} availability={p.availability} quantity={p.quantity ?? null} hasVariants={p.hasVariants === true} sellerName={p.sellerName} imageUrl={p.imageUrl} wishlistId={wishlist.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProductCard(props: {
  id: string;
  title: string;
  priceKopecks: number;
  availability: string;
  quantity: number | null;
  hasVariants: boolean;
  sellerName: string;
  imageUrl: string | null;
  favorite?: boolean;
  wishlistId?: string;
}) {
  const outOfStock = props.availability === "OUT_OF_STOCK" || props.quantity === 0;
  return (
    <div className="card flex gap-3 p-3">
      <Link href={`/product/${props.id}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.imageUrl} alt={props.title} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl">📦</div>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/product/${props.id}`} className="block truncate text-sm font-medium text-ink hover:text-svetlana-700">{props.title}</Link>
        <div className="mt-0.5 text-xs text-ink-soft">{props.sellerName}</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm font-bold text-svetlana-700">{rub(props.priceKopecks)}</span>
          <span className="text-xs text-ink-faint">{outOfStock ? "Нет в наличии" : availabilityLabel(props.availability)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {outOfStock ? (
            <span className="rounded-lg bg-surface-muted px-3 py-1.5 text-sm text-ink-faint">Нет в наличии</span>
          ) : props.hasVariants ? (
            <Link href={`/product/${props.id}`} className="rounded-lg bg-svetlana-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-svetlana-700">
              Выбрать вариант
            </Link>
          ) : (
            <AddToCartButton productId={props.id} outOfStock={false} />
          )}
          {props.favorite && <FavoriteButton productId={props.id} initialFavorite reloadOnChange />}
          {props.wishlistId && <WishlistRemoveButton productId={props.id} listId={props.wishlistId} />}
        </div>
      </div>
    </div>
  );
}
