/**
 * Сохранённые поиски объявлений и уведомления о новых объявлениях по ним.
 *
 * Храним в отдельной таблице "AikoSavedSearch", которую код создаёт сам
 * (CREATE TABLE IF NOT EXISTS): в схеме Prisma её нет, потому что рабочая база
 * получает только стартовую миграцию и новая модель туда бы не доехала.
 * Все поля текстовые, даты в ISO: одинаково работает в PostgreSQL и SQLite (тесты).
 * Важно: `prisma db push` по рабочей базе удалит эту таблицу, так делать нельзя.
 *
 * Уведомление уходит через notify(): в кабинет, на почту и в Telegram, если он
 * подключён. По одному поиску одно уведомление за проход фоновой задачи, и только
 * если появилось что-то новое; свои объявления человеку не считаем.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { notify } from "./notifications";
import { activeAdClause } from "../ad-active";
import { DEAL_TYPE_LABELS, VERTICAL_LABELS } from "../verticals";
import {
  MAX_SAVED_SEARCHES,
  alertText,
  cleanParams,
  paramsKey,
  searchHref,
  searchLabel,
  type SavedSearchParams,
} from "../saved-search";

export interface SavedSearch {
  id: string;
  params: SavedSearchParams;
  label: string;
  href: string;
  createdAt: string;
  lastSeenAt: string;
}

interface Row {
  id: string;
  userId: string;
  params: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
}

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "AikoSavedSearch" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "paramsKey" TEXT NOT NULL, "params" TEXT NOT NULL, "label" TEXT NOT NULL, "createdAt" TEXT NOT NULL, "lastSeenAt" TEXT NOT NULL)',
    );
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AikoSavedSearch_userId_idx" ON "AikoSavedSearch" ("userId")');
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** С таблицей: если базу пересоздали (тесты), пробуем ещё раз после создания. */
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

function parseParams(raw: string): SavedSearchParams {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? cleanParams(v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toSaved(r: Row): SavedSearch {
  const params = parseParams(r.params);
  return { id: r.id, params, label: r.label, href: searchHref(params), createdAt: r.createdAt, lastSeenAt: r.lastSeenAt };
}

/** Подпись с названиями раздела, сделки и города. */
export async function labelFor(p: SavedSearchParams): Promise<string> {
  const city = p.cityId
    ? await prisma.city.findUnique({ where: { id: p.cityId }, select: { name: true } }).catch(() => null)
    : null;
  const verticals = VERTICAL_LABELS as Record<string, string>;
  const deals = DEAL_TYPE_LABELS as Record<string, string>;
  return searchLabel(p, {
    vertical: p.vertical ? verticals[p.vertical] ?? null : null,
    dealType: p.dealType ? deals[p.dealType] ?? null : null,
    city: city?.name ?? null,
  });
}

export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  const rows = await withTable(
    () =>
      prisma.$queryRaw<Row[]>`SELECT "id", "userId", "params", "label", "createdAt", "lastSeenAt" FROM "AikoSavedSearch" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC`,
  );
  return rows.map(toSaved);
}

export type AddResult = "added" | "exists" | "limit";

export async function addSavedSearch(
  userId: string,
  raw: SavedSearchParams,
  label: string,
  now: Date = new Date(),
): Promise<AddResult> {
  const params = cleanParams(raw as Record<string, unknown>);
  const key = paramsKey(params);
  return withTable(async () => {
    const existing = await prisma.$queryRaw<{ id: string; paramsKey: string }[]>`SELECT "id", "paramsKey" FROM "AikoSavedSearch" WHERE "userId" = ${userId}`;
    if (existing.some((r) => r.paramsKey === key)) return "exists";
    if (existing.length >= MAX_SAVED_SEARCHES) return "limit";
    const iso = now.toISOString();
    await prisma.$executeRaw`INSERT INTO "AikoSavedSearch" ("id", "userId", "paramsKey", "params", "label", "createdAt", "lastSeenAt") VALUES (${randomUUID()}, ${userId}, ${key}, ${JSON.stringify(params)}, ${label.slice(0, 200)}, ${iso}, ${iso})`;
    return "added";
  });
}

export async function removeSavedSearch(userId: string, id: string): Promise<boolean> {
  if (!id) return false;
  const n = await withTable(() => prisma.$executeRaw`DELETE FROM "AikoSavedSearch" WHERE "id" = ${id} AND "userId" = ${userId}`);
  return n > 0;
}

/** Сколько новых чужих объявлений появилось после since. */
export async function countNewAds(userId: string, p: SavedSearchParams, since: Date): Promise<number> {
  const q = p.q?.trim();
  return prisma.classified.count({
    where: {
      status: "PUBLISHED",
      createdAt: { gt: since },
      authorId: { not: userId },
      AND: [activeAdClause()],
      ...(p.vertical ? { vertical: p.vertical } : {}),
      ...(p.dealType ? { dealType: p.dealType } : {}),
      ...(p.cityId ? { cityId: p.cityId } : {}),
      ...(q && q.length >= 2 ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
    },
  });
}

/** Фоновая задача: по каждому поиску одно уведомление, если появилось новое. */
export async function sendSavedSearchAlerts(options: { limit?: number; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 200)));
  const rows = await withTable(
    () =>
      prisma.$queryRaw<Row[]>`SELECT "id", "userId", "params", "label", "createdAt", "lastSeenAt" FROM "AikoSavedSearch" ORDER BY "lastSeenAt" ASC LIMIT ${Prisma.raw(String(limit))}`,
  );
  let sent = 0;
  for (const r of rows) {
    try {
      const saved = toSaved(r);
      const since = new Date(r.lastSeenAt);
      const count = await countNewAds(r.userId, saved.params, Number.isNaN(since.getTime()) ? now : since);
      if (count > 0) {
        const text = alertText(count, saved.label);
        await notify({ userId: r.userId, kind: "saved_search", title: text.title, body: text.body, url: saved.href });
        sent += 1;
      }
      await prisma.$executeRaw`UPDATE "AikoSavedSearch" SET "lastSeenAt" = ${now.toISOString()} WHERE "id" = ${r.id}`;
    } catch {
      // Один сломанный поиск не останавливает остальные.
    }
  }
  return sent;
}
