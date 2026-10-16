/**
 * Портфолио исполнителя в базе: одна запись на человека рядом с файлами
 * (IntegrationLink, provider "performer-portfolio"). Фото лежат в публичной папке
 * public/portfolio/<userId>, писать туда может только сам исполнитель.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { getStorageProvider } from "../storage";
import { UserFacingError } from "./engagement-rules";
import { addItem, cleanAbout, cleanItem, cleanSkills, orphanedImageKey, parsePortfolio, removeItem, type Portfolio } from "../portfolio";

const PROVIDER = "performer-portfolio";
const externalId = (userId: string) => `portfolio/${userId}`;

export async function loadPortfolio(userId: string): Promise<Portfolio> {
  const row = await prisma.integrationLink.findUnique({
    where: { provider_externalId: { provider: PROVIDER, externalId: externalId(userId) } },
    select: { secretBlob: true },
  });
  return parsePortfolio(row?.secretBlob, userId);
}

async function savePortfolio(userId: string, p: Portfolio): Promise<void> {
  const secretBlob = JSON.stringify(p);
  await prisma.integrationLink.upsert({
    where: { provider_externalId: { provider: PROVIDER, externalId: externalId(userId) } },
    create: { provider: PROVIDER, externalId: externalId(userId), secretBlob, externalScope: "[]", status: "ACTIVE" },
    update: { secretBlob, status: "ACTIVE", unlinkedAt: null },
  });
}

/** «О себе» и навыки. */
export async function updatePortfolioProfile(userId: string, input: { about?: unknown; skills?: unknown }): Promise<Portfolio> {
  const current = await loadPortfolio(userId);
  const next: Portfolio = { ...current, about: cleanAbout(input.about), skills: cleanSkills(input.skills) };
  await savePortfolio(userId, next);
  return next;
}

export async function addPortfolioItem(userId: string, input: { title?: unknown; description?: unknown; imageUrl?: unknown }): Promise<Portfolio> {
  const cleaned = cleanItem(input, userId);
  if (!cleaned.ok) throw new UserFacingError(cleaned.error, 400);
  const current = await loadPortfolio(userId);
  const added = addItem(current, cleaned.item, randomBytes(6).toString("hex"));
  if (!added.ok) throw new UserFacingError(added.error, 409);
  await savePortfolio(userId, added.portfolio);
  return added.portfolio;
}

/** Убирает работу и её фото из хранилища, если оно больше нигде не используется. */
export async function removePortfolioItem(userId: string, itemId: string): Promise<Portfolio> {
  const current = await loadPortfolio(userId);
  const removed = current.items.find((i) => i.id === itemId);
  if (!removed) throw new UserFacingError("Работа не найдена", 404);
  const next = removeItem(current, itemId);
  await savePortfolio(userId, next);
  const key = orphanedImageKey(removed, next, userId);
  // Фото удаляем после сохранения: если хранилище ответит ошибкой, работа всё равно убрана.
  if (key) await getStorageProvider().delete(key).catch(() => undefined);
  return next;
}
