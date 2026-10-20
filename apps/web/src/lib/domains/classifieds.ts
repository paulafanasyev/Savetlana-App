/**
 * Classifieds domain — real estate, auto, services and jobs in one unified model.
 *
 * Vertical-specific structured data lives in `attrs` and is validated here by
 * per-vertical schemas. A classified is NOT a Product: it has no stock and no
 * checkout; the deal happens between the parties (platform-facilitated).
 *
 * Honesty rules (spec §49):
 * - A VIN check is a fact, not an opinion. Until a real source adapter is
 *   configured, reports surface `NOT_PROVEN`, never a fabricated "clean".
 * - Geo is required for every ad and resolved from the seeded geo tree, so
 *   "Москва" is always a real city id, never a free-text label.
 *
 * Антифрод (шаг 2): каждое объявление перед публикацией проходит проверку
 * classified-guard. Опасное не публикуется, подозрительное уходит модератору.
 *
 * Резюме видят все, поэтому телефон, почту, мессенджеры, паспорт и СНИЛС из
 * его текста убираем ещё до проверки (lib/domains/contact-scrub.ts):
 * работодатель пишет соискателю через сообщения площадки.
 *
 * Поиск не показывает объявления с истёкшим сроком (lib/ad-active.ts).
 * Текст ищем без учёта регистра (lib/text-match.ts): «kia» находит «Kia Rio».
 */
import { prisma } from "../prisma";
import { readObject, writeJson } from "../db/json";
import {
  isValidEnum,
  ClassifiedVertical_VALUES,
  ClassifiedDealType_VALUES,
  ClassifiedStatus_VALUES,
  PropertyType_VALUES,
  AutoBodyType_VALUES,
  AutoFuelType_VALUES,
  AutoDriveType_VALUES,
} from "../db/enums";
import { audit } from "./audit";
import type { ClassifiedVerdict } from "./classified-guard";
import { recordSentToModeration, rejectIfBlocked, screenClassified } from "./classified-screening";
import { scrubResumeListing } from "./contact-scrub";
import { activeAdClause } from "../ad-active";
import { textMatchOr } from "../text-match";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassifiedAttrs {
  [key: string]: unknown;
}

export interface CreateClassifiedInput {
  vertical: string;
  dealType: string;
  title: string;
  description?: string;
  category: string;
  attrs?: ClassifiedAttrs;
  priceKopecks?: number;
  cityId: string;
  districtName?: string;
  addressLine?: string;
  metroId?: string;
  metroWalkMin?: number;
  lat?: number;
  lon?: number;
  images?: string[]; // storage keys/urls; first becomes the cover
  expiresInDays?: number;
}

export interface ClassifiedSearchFilters {
  vertical?: string;
  dealType?: string;
  regionId?: string;
  cityId?: string;
  metroId?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  query?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface PublicClassified {
  id: string;
  vertical: string;
  dealType: string;
  title: string;
  description: string | null;
  category: string;
  attrs: ClassifiedAttrs;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  currency: string;
  addressLine: string | null;
  regionName: string;
  cityName: string;
  districtName: string | null;
  metroName: string | null;
  metroLineName: string | null;
  metroWalkMin: number | null;
  coverImage: string | null;
  images: string[];
  authorName: string | null;
  authorId: string;
  sellerDisplayName: string | null;
  sellerVerified: boolean;
  views: number;
  createdAt: Date;
  status: string;
  vinCheck: PublicVinCheck | null;
}

export interface PublicVinCheck {
  id: string;
  vinMasked: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
  source: string;
  findings: unknown[];
  restrictions: unknown[];
  mileageKm: number | null;
  ownersCount: number | null;
  isWanted: boolean;
  hasRestrictions: boolean;
  checkedAt: Date | null;
  verification: "VERIFIED" | "NOT_PROVEN";
}

// ---------------------------------------------------------------------------
// Vertical attribute validation
// ---------------------------------------------------------------------------

const REAL_ESTATE_ATTRS = new Set([
  "propertyType", "roomsTotal", "roomsOffered", "floor", "floorsTotal",
  "areaTotal", "areaKitchen", "areaLiving", "buildingType", "buildingYear",
  "ceilingHeight", "bathrooms", "balcony", "loggia", "renovation", "furniture",
  "appliances", "heating", "gas", "water", "electricity", "sewage",
  "plotArea", "landStatus", "elevator", "parking", "security", "internet",
  "totalFloorsInBuilding", "houseMaterial", "transactionType", "mortgagePossible",
]);

const AUTO_ATTRS = new Set([
  "brand", "model", "year", "bodyType", "fuelType", "driveType", "transmission",
  "engineVolumeCc", "enginePowerHp", "mileageKm", "ownersCount", "steeringWheel",
  "color", "condition", "wheels", "vin", "licensePlate", "doorsCount",
  "seatsCount", "trunkVolumeL", "clearanceMm", "equipment", "warranty",
  "serviceHistory", "accidents", "isOwner", "pts", " sts",
]);

const SERVICE_ATTRS = new Set([
  "serviceCategory", "serviceType", "experienceYears", "qualification",
  "format", "durationMin", "schedule", "materialsIncluded", "minimumOrder",
  "portfolio", "certificates", "languages", "availability", "travelToClient",
  "warranty", "prepayment",
]);

const JOB_ATTRS = new Set([
  "companyName", "employment", "schedule", "workFormat", "experience",
  "salaryTo", "salaryPeriod", "salaryTax", "contract", "education",
]);

function validateAttrs(vertical: string, attrs: ClassifiedAttrs): ClassifiedAttrs {
  const allowed =
    vertical === "REAL_ESTATE" ? REAL_ESTATE_ATTRS :
    vertical === "AUTO" ? AUTO_ATTRS :
    vertical === "SERVICE" ? SERVICE_ATTRS :
    vertical === "JOB" ? JOB_ATTRS : new Set<string>();

  const clean: ClassifiedAttrs = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (allowed.has(k)) clean[k] = v;
  }

  // Enum-typed attributes must be canonical; drop instead of coercing.
  if (vertical === "REAL_ESTATE") {
    if (clean.propertyType && !isValidEnum("PropertyType", clean.propertyType as string)) {
      delete clean.propertyType;
    }
  }
  if (vertical === "AUTO") {
    if (clean.bodyType && !isValidEnum("AutoBodyType", clean.bodyType as string)) delete clean.bodyType;
    if (clean.fuelType && !isValidEnum("AutoFuelType", clean.fuelType as string)) delete clean.fuelType;
    if (clean.driveType && !isValidEnum("AutoDriveType", clean.driveType as string)) delete clean.driveType;
  }

  return clean;
}

// ---------------------------------------------------------------------------
// VIN masking & hashing
// ---------------------------------------------------------------------------

export function maskVin(vin: string): string {
  const v = vin.trim().toUpperCase();
  if (v.length < 8) return v;
  return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
}

export async function hashVin(vin: string): Promise<string> {
  const enc = new TextEncoder();
  const secret = process.env.VIN_HASH_SECRET ?? "svetlana-vin-hash-dev";
  const data = enc.encode(secret + ":" + vin.trim().toUpperCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidVin(vin: string): boolean {
  const v = vin.trim().toUpperCase();
  // Real VINs are 17 chars, ASCII without I/O/Q. We accept partial
  // Japanese-market 10-12 char frame numbers too, but mark them short.
  return /^[A-HJ-NPR-Z0-9]{10,17}$/.test(v);
}

// ---------------------------------------------------------------------------
// Geo resolution
// ---------------------------------------------------------------------------

export async function resolveCity(cityId: string) {
  return prisma.city.findUnique({
    where: { id: cityId },
    include: { region: true },
  });
}

export async function searchCities(query: string, limit = 10) {
  const q = query.trim();
  if (q.length < 2) return [];
  return prisma.city.findMany({
    // «москва» находит «Москва» и в PostgreSQL.
    where: { OR: textMatchOr(q, ["name"] as const) },
    include: { region: true },
    take: limit,
    orderBy: { population: "desc" },
  });
}

export async function getGeoTree() {
  const districts = await prisma.federalDistrict.findMany({
    include: {
      regions: {
        include: { cities: { orderBy: { population: "desc" } } },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return districts;
}

export async function getMetroForCity(cityId: string) {
  return prisma.metroLine.findMany({
    where: { cityId },
    include: { stations: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Create / publish
// ---------------------------------------------------------------------------

export async function createClassified(
  authorId: string,
  input: CreateClassifiedInput,
  opts: { aiDraft?: boolean; sellerId?: string; actorRole?: string } = {}
) {
  if (!isValidEnum("ClassifiedVertical", input.vertical)) {
    throw new Error("unknown_classified_vertical");
  }
  if (!isValidEnum("ClassifiedDealType", input.dealType)) {
    throw new Error("unknown_deal_type");
  }
  if (!input.title || input.title.trim().length < 5) {
    throw new Error("title_too_short");
  }

  const city = await resolveCity(input.cityId);
  if (!city) throw new Error("unknown_city");

  const attrs = validateAttrs(input.vertical, input.attrs ?? {});
  const priceKopecks = Math.max(0, Math.floor(input.priceKopecks ?? 0));
  const cleaned = scrubResumeListing({ vertical: input.vertical, dealType: input.dealType, title: input.title.trim(), description: input.description });
  const title = cleaned.title.trim();
  const description = cleaned.description;
  if (title.length < 5) throw new Error("title_too_short");

  // Антифрод: опасное объявление не создаётся, подозрительное ждёт модератора.
  const screening = await screenClassified({
    authorId,
    cityId: city.id,
    vertical: input.vertical,
    dealType: input.dealType,
    title,
    description: description ?? null,
    category: input.category,
    priceKopecks,
    attrs,
    images: input.images,
  });
  await rejectIfBlocked(authorId, screening);
  const needsReview = screening.verdict === "review";

  const created = await prisma.classified.create({
    data: {
      vertical: input.vertical,
      dealType: input.dealType,
      authorId,
      sellerId: opts.sellerId,
      title,
      description: description?.trim() || null,
      category: input.category,
      attrs: writeJson(attrs),
      priceKopecks,
      regionId: city.regionId,
      cityId: city.id,
      districtName: input.districtName?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      metroId: input.metroId || null,
      metroWalkMin: input.metroWalkMin ?? null,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      status: opts.aiDraft ? "DRAFT" : needsReview ? "MODERATION" : "PUBLISHED",
      aiDraft: opts.aiDraft ?? false,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86400_000)
        : new Date(Date.now() + 30 * 86400_000),
      images: input.images?.length
        ? { create: input.images.map((url, i) => ({ url, isCover: i === 0 })) }
        : undefined,
    },
    include: { images: true },
  });

  if (needsReview && !opts.aiDraft) await recordSentToModeration(authorId, created.id, screening);

  await audit({
    actorId: authorId,
    actorRole: opts.actorRole ?? "BUYER",
    action: "classified.created",
    targetType: "Classified",
    targetId: created.id,
    before: null,
    after: { vertical: created.vertical, title: created.title, cityId: created.cityId, status: created.status },
  });

  return Object.assign(created, { screening, contactsRemoved: cleaned.removed });
}

export async function publishClassified(classifiedId: string, authorId: string) {
  const found = await prisma.classified.findUnique({ where: { id: classifiedId }, include: { images: true } });
  if (!found) throw new Error("not_found");
  if (found.authorId !== authorId) throw new Error("forbidden");
  if (found.status === "MODERATION") return found;

  // Черновик (в том числе от Светланы) проверяется так же, как новое объявление.
  const screening: ClassifiedVerdict = await screenClassified({
    authorId,
    cityId: found.cityId,
    vertical: found.vertical,
    dealType: found.dealType,
    title: found.title,
    description: found.description,
    category: found.category,
    priceKopecks: found.priceKopecks,
    attrs: readObject(found.attrs),
    images: found.images.map((i) => i.url),
    excludeId: found.id,
  });
  await rejectIfBlocked(authorId, screening);
  const status = screening.verdict === "review" ? "MODERATION" : "PUBLISHED";

  const updated = await prisma.classified.update({
    where: { id: classifiedId },
    data: {
      status,
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    },
  });
  if (status === "MODERATION") await recordSentToModeration(authorId, classifiedId, screening);

  await audit({
    actorId: authorId,
    actorRole: "BUYER",
    action: "classified.published",
    targetType: "Classified",
    targetId: classifiedId,
    before: { status: found.status },
    after: { status },
  });

  return updated;
}

export async function incrementViews(classifiedId: string) {
  await prisma.classified.update({
    where: { id: classifiedId },
    data: { views: { increment: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchClassifieds(
  filters: ClassifiedSearchFilters
): Promise<{ items: PublicClassified[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);

  const where: Record<string, unknown> = {
    status: filters.status && isValidEnum("ClassifiedStatus", filters.status) ? filters.status : "PUBLISHED",
    // Истёкшие по сроку объявления в поиске не показываем; AND, чтобы не перетереть OR поиска по тексту.
    AND: [activeAdClause()],
  };
  if (filters.vertical && isValidEnum("ClassifiedVertical", filters.vertical)) {
    where.vertical = filters.vertical;
  }
  if (filters.dealType && isValidEnum("ClassifiedDealType", filters.dealType)) {
    where.dealType = filters.dealType;
  }
  if (filters.regionId) where.regionId = filters.regionId;
  if (filters.cityId) where.cityId = filters.cityId;
  if (filters.metroId) where.metroId = filters.metroId;
  if (filters.category) where.category = { contains: filters.category };
  if (filters.priceMin != null || filters.priceMax != null) {
    where.priceKopecks = {
      ...(filters.priceMin != null ? { gte: filters.priceMin } : {}),
      ...(filters.priceMax != null ? { lte: filters.priceMax } : {}),
    };
  }
  if (filters.query && filters.query.trim().length >= 2) {
    // Без учёта регистра: «kia» находит «Kia Rio».
    where.OR = textMatchOr(filters.query, ["title", "description"] as const);
  }
  if (filters.cursor) {
    where.id = { gt: filters.cursor };
  }

  const rows = await prisma.classified.findMany({
    where,
    include: {
      images: { orderBy: { isCover: "desc" } },
      author: { select: { name: true } },
      seller: { select: { displayName: true, identityStatus: true, isActivated: true } },
      region: { select: { name: true } },
      city: { select: { name: true } },
      metro: { include: { line: { select: { name: true } } } },
      vinChecks: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const items = slice.map((r) => toPublic(r as unknown as ClassifiedRow));
  return {
    items,
    nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
  };
}

type ClassifiedRow = {
  id: string; vertical: string; dealType: string; title: string;
  description: string | null; category: string; attrs: string;
  priceKopecks: number; oldPriceKopecks: number | null; currency: string;
  addressLine: string | null;
  districtName: string | null; metroWalkMin: number | null; views: number;
  createdAt: Date; status: string; authorId: string;
  region: { name: string }; city: { name: string };
  metro: { name: string; line: { name: string } } | null;
  author: { name: string | null };
  seller: { displayName: string; identityStatus: string; isActivated: boolean } | null;
  images: { url: string; isCover: boolean }[];
  vinChecks: {
    id: string; vin: string; make: string | null; model: string | null; year: number | null;
    status: string; source: string; findings: string; restrictions: string;
    mileageKm: number | null; ownersCount: number | null; isWanted: boolean;
    hasRestrictions: boolean; checkedAt: Date | null; createdAt: Date;
    verification: string | null;
  }[];
};

function toPublic(r: ClassifiedRow): PublicClassified {
  const cover = r.images.find((i) => i.isCover) ?? r.images[0];
  const vin = r.vinChecks[0];
  // verification is persisted at check time by the VIN domain; never
  // re-derived here (a sandbox report stays NOT_PROVEN, spec §49).

  return {
    id: r.id,
    vertical: r.vertical,
    dealType: r.dealType,
    title: r.title,
    description: r.description,
    category: r.category,
    attrs: readObject(r.attrs),
    priceKopecks: r.priceKopecks,
    oldPriceKopecks: r.oldPriceKopecks,
    currency: r.currency,
    addressLine: r.addressLine,
    regionName: r.region.name,
    cityName: r.city.name,
    districtName: r.districtName,
    metroName: r.metro?.name ?? null,
    metroLineName: r.metro?.line.name ?? null,
    metroWalkMin: r.metroWalkMin,
    coverImage: cover?.url ?? null,
    images: r.images.map((i) => i.url),
    authorName: r.author.name,
    authorId: r.authorId,
    sellerDisplayName: r.seller?.displayName ?? null,
    sellerVerified:
      r.seller?.identityStatus === "VERIFIED" && (r.seller?.isActivated ?? false),
    views: r.views,
    createdAt: r.createdAt,
    status: r.status,
    vinCheck: vin
      ? {
          id: vin.id,
          vinMasked: maskVin(vin.vin),
          make: vin.make,
          model: vin.model,
          year: vin.year,
          status: vin.status,
          source: vin.source,
          findings: safeParseArr(vin.findings),
          restrictions: safeParseArr(vin.restrictions),
          mileageKm: vin.mileageKm,
          ownersCount: vin.ownersCount,
          isWanted: vin.isWanted,
          hasRestrictions: vin.hasRestrictions,
          checkedAt: vin.checkedAt,
          verification: vin.verification === "VERIFIED" ? "VERIFIED" : "NOT_PROVEN",
        }
      : null,
  };
}

function safeParseArr(v: string): unknown[] {
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function getClassifiedPublic(id: string): Promise<PublicClassified | null> {
  const row = await prisma.classified.findFirst({
    where: { id, status: { in: ["PUBLISHED", "DRAFT"] } },
    include: {
      images: { orderBy: { isCover: "desc" } },
      author: { select: { name: true } },
      seller: { select: { displayName: true, identityStatus: true, isActivated: true } },
      region: { select: { name: true } },
      city: { select: { name: true } },
      metro: { include: { line: { select: { name: true } } } },
      vinChecks: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!row) return null;
  if (row.status === "DRAFT") {
    // Drafts are visible only to their author.
    return null;
  }
  return toPublic(row as unknown as ClassifiedRow);
}

export async function listMyClassifieds(authorId: string) {
  return prisma.classified.findMany({
    where: { authorId },
    include: { images: { take: 1 }, city: { select: { name: true } }, region: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}
