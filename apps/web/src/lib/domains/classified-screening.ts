/**
 * Проверка объявления перед публикацией и очередь модерации.
 *
 * block  — объявление не создаётся, автор видит причину, в рисках пишется факт;
 *          три блокировки за сутки поднимают уровень до REVIEW.
 * review — объявление сохраняется со статусом MODERATION и не видно в поиске,
 *          пока модератор не одобрит.
 * Тексты объявлений в риски не копируем: только коды правил и id объявления.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { readObject } from "../db/json";
import { audit } from "./audit";
import { notify } from "./notifications";
import { UserFacingError } from "./engagement-rules";
import { explainClassified, scanClassified, type ClassifiedForScan, type ClassifiedVerdict } from "./classified-guard";
import { photoDigests } from "../classified-fields";

const COMPARABLES_LIMIT = 300;

function ownDomains(): string[] {
  try {
    return [new URL(env.publicAppUrl).hostname];
  } catch {
    return [];
  }
}

export interface ScreenInput extends ClassifiedForScan {
  authorId: string;
  cityId: string;
  images?: string[];
  /** Своё объявление не сравниваем само с собой при повторной публикации. */
  excludeId?: string;
}

export async function screenClassified(input: ScreenInput): Promise<ClassifiedVerdict> {
  const [rows, duplicatePhotoAds] = await Promise.all([
    input.vertical === "SERVICE" || input.priceKopecks <= 0
      ? Promise.resolve([] as { priceKopecks: number; attrs: string }[])
      : prisma.classified.findMany({
          where: {
            vertical: input.vertical,
            dealType: input.dealType,
            cityId: input.cityId,
            status: "PUBLISHED",
            priceKopecks: { gt: 0 },
            ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
          },
          select: { priceKopecks: true, attrs: true },
          orderBy: { createdAt: "desc" },
          take: COMPARABLES_LIMIT,
        }),
    input.images && input.images.length > 0
      ? prisma.classified.count({
          where: {
            authorId: { not: input.authorId },
            images: { some: { OR: [{ url: { in: input.images } }, ...photoDigests(input.images).map((d) => ({ url: { contains: d } }))] } },
          },
        })
      : Promise.resolve(0),
  ]);
  return scanClassified(input, {
    ownDomains: ownDomains(),
    comparables: rows.map((r) => ({ priceKopecks: r.priceKopecks, attrs: readObject(r.attrs) })),
    duplicatePhotoAds,
  });
}

/** Бросает понятную ошибку, если объявление нельзя публиковать. */
export async function rejectIfBlocked(authorId: string, verdict: ClassifiedVerdict): Promise<void> {
  if (verdict.verdict !== "block") return;
  const codes = verdict.findings.map((f) => f.code);
  const recent = await prisma.riskEvent.count({
    where: {
      actorType: "user",
      actorId: authorId,
      ruleId: { in: ["C2_classified_blocked", "C3_repeated_blocked_classifieds"] },
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  const repeated = recent + 1 >= 3;
  await prisma.riskEvent.create({
    data: {
      actorType: "user",
      actorId: authorId,
      level: repeated ? "REVIEW" : "HIGH",
      ruleId: repeated ? "C3_repeated_blocked_classifieds" : "C2_classified_blocked",
      description: repeated ? "повторные попытки разместить мошенническое объявление" : "объявление с признаками мошенничества не опубликовано",
      signals: JSON.stringify({ codes, blockedLast24h: recent + 1 }),
      explanation: explainClassified(verdict),
      actionTaken: repeated ? "manual_review" : "classified_blocked",
    },
  });
  throw new UserFacingError(`Объявление не опубликовано. ${explainClassified(verdict)}.`, 422);
}

/** Запись в риски об объявлении, отправленном на проверку. */
export async function recordSentToModeration(authorId: string, classifiedId: string, verdict: ClassifiedVerdict): Promise<void> {
  await prisma.riskEvent.create({
    data: {
      actorType: "user",
      actorId: authorId,
      level: "REVIEW",
      ruleId: "C1_classified_moderation",
      description: "объявление отправлено на проверку модератору",
      signals: JSON.stringify({ classifiedId, codes: verdict.findings.map((f) => f.code) }),
      explanation: explainClassified(verdict),
      actionTaken: "sent_to_moderation",
    },
  });
}

export interface ModerationItem {
  id: string;
  title: string;
  vertical: string;
  dealType: string;
  priceKopecks: number;
  cityName: string;
  authorName: string | null;
  authorEmail: string;
  createdAt: Date;
  codes: string[];
  explanation: string | null;
}

/** Объявления на проверке, с причинами из журнала рисков. */
export async function listModerationQueue(limit = 100): Promise<ModerationItem[]> {
  const ads = await prisma.classified.findMany({
    where: { status: "MODERATION" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true, title: true, vertical: true, dealType: true, priceKopecks: true, createdAt: true, authorId: true,
      city: { select: { name: true } },
      author: { select: { name: true, email: true } },
    },
  });
  const events = ads.length
    ? await prisma.riskEvent.findMany({
        where: { ruleId: "C1_classified_moderation", actorId: { in: [...new Set(ads.map((a) => a.authorId))] } },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: { signals: true, explanation: true },
      })
    : [];
  const byAd = new Map<string, { codes: string[]; explanation: string | null }>();
  for (const e of events) {
    const s = readObject(e.signals) as { classifiedId?: unknown; codes?: unknown };
    if (typeof s.classifiedId === "string" && !byAd.has(s.classifiedId)) {
      byAd.set(s.classifiedId, { codes: Array.isArray(s.codes) ? s.codes.map(String) : [], explanation: e.explanation });
    }
  }
  return ads.map((a) => ({
    id: a.id,
    title: a.title,
    vertical: a.vertical,
    dealType: a.dealType,
    priceKopecks: a.priceKopecks,
    cityName: a.city.name,
    authorName: a.author.name,
    authorEmail: a.author.email,
    createdAt: a.createdAt,
    codes: byAd.get(a.id)?.codes ?? [],
    explanation: byAd.get(a.id)?.explanation ?? null,
  }));
}

/** Решение модератора: опубликовать или отклонить. */
export async function moderateClassified(classifiedId: string, approve: boolean, adminId: string, note?: string) {
  const ad = await prisma.classified.findUnique({ where: { id: classifiedId }, select: { id: true, status: true, authorId: true, title: true } });
  if (!ad) throw new UserFacingError("Объявление не найдено", 404);
  if (ad.status !== "MODERATION") throw new UserFacingError("Объявление уже не на проверке", 409);
  const status = approve ? "PUBLISHED" : "REJECTED";
  await prisma.classified.update({
    where: { id: classifiedId },
    data: approve ? { status, expiresAt: new Date(Date.now() + 30 * 86400_000) } : { status },
  });
  await audit({
    actorId: adminId,
    actorRole: "admin",
    action: approve ? "classified.moderation_approved" : "classified.moderation_rejected",
    targetType: "Classified",
    targetId: classifiedId,
    before: { status: ad.status },
    after: { status, note: note?.slice(0, 300) ?? null },
  });
  await notify({
    userId: ad.authorId,
    kind: "security",
    title: approve ? "Объявление опубликовано" : "Объявление отклонено",
    body: approve
      ? `«${ad.title}» прошло проверку и теперь видно покупателям.`
      : `«${ad.title}» не прошло проверку.${note ? ` Причина: ${note.slice(0, 300)}` : ""}`,
    url: approve ? `/classifieds/${classifiedId}` : "/classifieds/new",
  }).catch(() => undefined);
  return { id: classifiedId, status };
}
