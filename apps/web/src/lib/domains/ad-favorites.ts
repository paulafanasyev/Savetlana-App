/**
 * Избранное для объявлений (у товаров своё, см. collections.ts).
 *
 * Таблица "AikoAdFavorite" создаётся кодом (CREATE TABLE IF NOT EXISTS), как и у
 * сохранённых поисков: рабочая база получает только стартовую миграцию.
 * Ключ записи «пользователь:объявление», поэтому повторов не бывает.
 * Не делать `prisma db push` по рабочей базе: он удалит таблицу.
 */
import { prisma } from "../prisma";
import { readObject } from "../db/json";
import { isAdActive } from "../ad-active";

/** Сколько объявлений можно хранить в избранном. */
export const MAX_AD_FAVORITES = 200;

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "AikoAdFavorite" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "classifiedId" TEXT NOT NULL, "createdAt" TEXT NOT NULL)',
    );
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AikoAdFavorite_userId_idx" ON "AikoAdFavorite" ("userId")');
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

async function withTable<T>(fn: () => Promise<T>): Promise<T> {
  await ensureTable();
  try {
    return await fn();
  } catch {
    ready = null;
    await ensureTable();
    return fn();
  }
}

const key = (userId: string, adId: string) => `${userId}:${adId}`;

export async function isAdFavorite(userId: string, adId: string): Promise<boolean> {
  const rows = await withTable(() => prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AikoAdFavorite" WHERE "id" = ${key(userId, adId)}`);
  return rows.length > 0;
}

export type ToggleResult = "added" | "removed" | "limit" | "not_found";

/** Добавить или убрать объявление из избранного. Своё тоже можно, это не вредно. */
export async function toggleAdFavorite(userId: string, adId: string, now: Date = new Date()): Promise<ToggleResult> {
  if (!adId) return "not_found";
  if (await isAdFavorite(userId, adId)) {
    await prisma.$executeRaw`DELETE FROM "AikoAdFavorite" WHERE "id" = ${key(userId, adId)}`;
    return "removed";
  }
  const ad = await prisma.classified.findUnique({ where: { id: adId }, select: { id: true } });
  if (!ad) return "not_found";
  const [{ n }] = await prisma.$queryRaw<{ n: unknown }[]>`SELECT COUNT(*) AS "n" FROM "AikoAdFavorite" WHERE "userId" = ${userId}`;
  if (Number(n) >= MAX_AD_FAVORITES) return "limit";
  await prisma.$executeRaw`INSERT INTO "AikoAdFavorite" ("id", "userId", "classifiedId", "createdAt") VALUES (${key(userId, adId)}, ${userId}, ${adId}, ${now.toISOString()}) ON CONFLICT ("id") DO NOTHING`;
  return "added";
}

export interface FavoriteAd {
  id: string;
  title: string;
  priceKopecks: number;
  dealType: string;
  vertical: string;
  attrs: Record<string, unknown>;
  cityName: string;
  cover: string | null;
  /** Объявление ещё действует (опубликовано и не истекло). */
  active: boolean;
}

/** Избранные объявления, новые первыми. Снятые остаются с пометкой, удалённые пропадают. */
export async function listAdFavorites(userId: string, now: Date = new Date()): Promise<FavoriteAd[]> {
  const rows = await withTable(
    () => prisma.$queryRaw<{ classifiedId: string }[]>`SELECT "classifiedId" FROM "AikoAdFavorite" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC`,
  );
  const ids = rows.map((r) => r.classifiedId).slice(0, MAX_AD_FAVORITES);
  if (ids.length === 0) return [];
  const ads = await prisma.classified.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      priceKopecks: true,
      dealType: true,
      vertical: true,
      attrs: true,
      status: true,
      expiresAt: true,
      city: { select: { name: true } },
      images: { select: { url: true }, orderBy: { isCover: "desc" }, take: 1 },
    },
  });
  const byId = new Map(ads.map((a) => [a.id, a]));
  const out: FavoriteAd[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    out.push({
      id: a.id,
      title: a.title,
      priceKopecks: a.priceKopecks,
      dealType: a.dealType,
      vertical: a.vertical,
      attrs: readObject(a.attrs as unknown as string),
      cityName: a.city.name,
      cover: a.images[0]?.url ?? null,
      active: a.status === "PUBLISHED" && isAdActive(a.expiresAt, now),
    });
  }
  return out;
}
