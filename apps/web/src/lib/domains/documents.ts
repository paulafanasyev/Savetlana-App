/**
 * Documents & Certificates (spec §20).
 *
 * Document status is an explicit state machine. OCR text is extracted only to
 * help a human reviewer; legal validity is NEVER asserted from OCR alone
 * (spec §20: "Не утверждать юридическую действительность документа только на
 * основании OCR").
 */
import { prisma } from "../prisma";
import { parseEnum } from "../db/enums";
import { audit } from "./audit";

export type DocumentStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "VERIFIED"
  | "REJECTED"
  | "EXPIRED"
  | "PENDING_REVIEW";

export type DocumentKind =
  | "company_doc"
  | "certificate"
  | "declaration"
  | "license"
  | "product_doc";

const TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  UPLOADED: ["PROCESSING"],
  PROCESSING: ["PENDING_REVIEW", "VERIFIED", "REJECTED", "EXPIRED"],
  PENDING_REVIEW: ["VERIFIED", "REJECTED", "EXPIRED"],
  VERIFIED: ["EXPIRED"],
  REJECTED: ["UPLOADED"],
  EXPIRED: [],
};

export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Compliance rules: which documents a category can require. This is a rule
 * table, not an LLM opinion, so the requirement itself is auditable and
 * deterministic. Documents are *recommended*: absence is flagged, never
 * silently treated as satisfied.
 */
const CATEGORY_REQUIRED_DOCS: Record<string, DocumentKind[]> = {
  electronics: ["declaration", "certificate"],
  tools: ["declaration"],
  home: ["certificate"],
  clothing: [],
  services: ["certificate"],
  digital: [],
};

export interface DocRequirements {
  required: DocumentKind[];
  optional: DocumentKind[];
  missing: DocumentKind[];
}

export async function requirementsForSeller(sellerId: string): Promise<DocRequirements> {
  const products = await prisma.product.findMany({
    where: { sellerId, status: { not: "ARCHIVED" } },
    select: { category: { select: { slug: true } } },
  });
  const categorySlugs = new Set(products.map((p) => p.category?.slug).filter(Boolean) as string[]);

  const required = new Set<DocumentKind>();
  for (const slug of categorySlugs) {
    for (const kind of CATEGORY_REQUIRED_DOCS[slug] ?? []) required.add(kind);
  }
  if (required.size === 0) required.add("company_doc");

  const have = await prisma.sellerDocument.findMany({
    where: { sellerId, status: { in: ["VERIFIED", "PENDING_REVIEW", "PROCESSING"] } },
    select: { kind: true },
  });
  const haveKinds = new Set(have.map((d) => d.kind as DocumentKind));

  return {
    required: [...required],
    optional: ["license"],
    missing: [...required].filter((k) => !haveKinds.has(k)),
  };
}

export interface UploadDocumentInput {
  sellerId: string;
  kind: DocumentKind;
  title: string;
  fileUrl: string;
  storageKey?: string;
  fileHash: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt?: Date;
}

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export async function uploadDocument(input: UploadDocumentInput) {
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) {
    throw new Error("файл превышает допустимый размер 20 МБ");
  }
  if (!ALLOWED_MIME.includes(input.mimeType)) {
    throw new Error(`неподдерживаемый тип файла: ${input.mimeType}`);
  }
  const dup = await prisma.sellerDocument.findFirst({
    where: { sellerId: input.sellerId, fileHash: input.fileHash },
  });
  if (dup) throw new Error("документ с таким хешем уже загружен");

  const doc = await prisma.sellerDocument.create({
    data: {
      sellerId: input.sellerId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      fileUrl: input.fileUrl,
      storageKey: input.storageKey,
      fileHash: input.fileHash,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "UPLOADED",
      expiresAt: input.expiresAt,
    },
  });
  await audit({
    actorId: input.sellerId,
    actorRole: "seller",
    action: "document.uploaded",
    targetType: "seller_document",
    targetId: doc.id,
    after: { kind: input.kind, title: input.title },
  });
  return doc;
}

/**
 * Processing extracts OCR text for the reviewer, then parks the document in
 * PENDING_REVIEW. Only a human (or an official-source adapter) can move it to
 * VERIFIED — and the audit log records who.
 */
export async function processDocument(documentId: string, ocrText: string | null) {
  const doc = await prisma.sellerDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("документ не найден");
  await prisma.sellerDocument.update({
    where: { id: documentId },
    data: { ocrText: ocrText ? ocrText.slice(0, 20000) : null, status: "PENDING_REVIEW" },
  });
  return { status: "PENDING_REVIEW" as const, ocrExtracted: Boolean(ocrText) };
}

export async function verifyDocument(
  documentId: string,
  verifiedBy: string,
  expiresAt?: Date
) {
  const doc = await prisma.sellerDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("документ не найден");
  const from = parseEnum<DocumentStatus>("DocumentStatus", doc.status, "UPLOADED");
  if (!canTransitionDocument(from, "VERIFIED")) {
    throw new Error(`нельзя верифицировать документ в статусе ${from}`);
  }
  const updated = await prisma.sellerDocument.update({
    where: { id: documentId },
    data: { status: "VERIFIED", verifiedBy, verifiedAt: new Date(), expiresAt },
  });
  await audit({
    actorId: verifiedBy,
    actorRole: "admin",
    action: "document.verified",
    targetType: "seller_document",
    targetId: documentId,
    before: { status: from },
    after: { status: "VERIFIED" },
  });
  return updated;
}

export async function rejectDocument(documentId: string, actorId: string, reason: string) {
  const updated = await prisma.sellerDocument.update({
    where: { id: documentId },
    data: { status: "REJECTED", rejectionReason: reason.slice(0, 1000) },
  });
  await audit({
    actorId,
    actorRole: "admin",
    action: "document.rejected",
    targetType: "seller_document",
    targetId: documentId,
    after: { reason },
  });
  return updated;
}

/**
 * Expiry sweep: documents past their expiry date are marked EXPIRED so trust
 * scoring stops counting them (spec §20, §41).
 */
export async function sweepExpiredDocuments(now = new Date()): Promise<number> {
  const result = await prisma.sellerDocument.updateMany({
    where: {
      status: { in: ["VERIFIED", "PENDING_REVIEW"] },
      expiresAt: { lt: now },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export async function listDocuments(sellerId: string) {
  return prisma.sellerDocument.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
  });
}
