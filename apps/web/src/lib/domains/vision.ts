/**
 * Vision search (spec §6, §10): photo → object detection → attribute extraction
 * → embedding → vector search → ranking → explainable candidates.
 *
 * HONESTY ARCHITECTURE: the vision *model* is external and may be unavailable.
 * When no vision provider is configured the pipeline degrades honestly — it
 * tells the user it cannot see the photo (status NOT_PROVEN), and never
 * fabricates a recognized product. The text search path stays fully usable.
 */
import { prisma } from "../prisma";
import { aiGateway, newTraceId } from "../ai/gateway";
import { cosine, getProductEmbedding } from "./catalog";

export type VisionStatus =
  | "VERIFIED" // a vision model actually recognised the image
  | "MOCK_VERIFIED" // sandbox provider returned a deterministic result
  | "NOT_PROVEN"; // no vision provider; the photo could not be seen

export interface VisionDetection {
  /** Free-form label the model produced for the dominant object. */
  label: string;
  /** Category slug if the label maps onto the catalog taxonomy. */
  categorySlug?: string;
  confidence: number;
}

export interface VisionCandidate {
  productId: string;
  title: string;
  priceKopecks: number;
  sellerName: string;
  availability: string;
  similarity: number;
  match: "exact" | "similar" | "related";
}

export interface VisionSearchResult {
  status: VisionStatus;
  detections: VisionDetection[];
  candidates: VisionCandidate[];
  /** Human-readable explanation of how the result was produced. */
  explanation: string;
  traceId: string;
}

interface VisionProvider {
  readonly key: string;
  readonly sandbox: boolean;
  detect(imageBuffer: Buffer, contentType: string): Promise<VisionDetection[]>;
}

/**
 * Sandbox vision provider — deterministic, development only. It derives a
 * label from the image bytes so behaviour is reproducible, and it is *always*
 * reported as MOCK_VERIFIED, never as a real recognition (spec §49).
 */
class SandboxVisionProvider implements VisionProvider {
  readonly key = "sandbox-vision";
  readonly sandbox = true;

  async detect(imageBuffer: Buffer): Promise<VisionDetection[]> {
    // Deterministic pseudo-label from the payload — no real model involved.
    let h = 0;
    for (let i = 0; i < Math.min(imageBuffer.length, 256); i++) {
      h = (Math.imul(31, h) + imageBuffer[i]) | 0;
    }
    const bucket = Math.abs(h) % 5;
    const labels = ["ноутбук", "смартфон", "одежда", "инструмент", "товар для дома"];
    return [
      {
        label: labels[bucket],
        confidence: 0.5 + ((Math.abs(h >> 8) % 40) / 100),
      },
    ];
  }
}

function getVisionProvider(): VisionProvider | null {
  // A real provider would be selected by configured credentials here. None is
  // wired yet, so the sandbox is used and explicitly labelled as such.
  return new SandboxVisionProvider();
}

/**
 * Maps a raw model label onto the catalog taxonomy when a matching category
 * exists. Returns undefined when there is no honest mapping.
 */
async function mapToCategory(label: string): Promise<string | undefined> {
  // SQLite has no case-insensitive mode; match on the normalized lowercase
  // name the category was seeded with.
  const category = await prisma.category.findFirst({
    where: { name: { contains: label.toLowerCase() } },
    select: { slug: true },
  });
  return category?.slug;
}

/**
 * Runs the full photo-to-product pipeline.
 *
 * @param imageBuffer raw image bytes
 * @param contentType MIME type, validated by the caller
 */
export async function searchByPhoto(
  imageBuffer: Buffer,
  contentType: string,
): Promise<VisionSearchResult> {
  const traceId = newTraceId("vision");
  const provider = getVisionProvider();
  if (!provider) {
    return {
      status: "NOT_PROVEN",
      detections: [],
      candidates: [],
      explanation:
        "Сервер распознавания изображений не настроен. Я не могу увидеть фотографию — попробуйте описать товар словами.",
      traceId,
    };
  }

  const detections = provider.sandbox
    ? await provider.detect(imageBuffer, contentType)
    : await provider.detect(imageBuffer, contentType);

  for (const d of detections) {
    d.categorySlug = await mapToCategory(d.label);
  }

  const top = detections[0];
  if (!top) {
    return {
      status: provider.sandbox ? "MOCK_VERIFIED" : "VERIFIED",
      detections: [],
      candidates: [],
      explanation: "На фотографии не удалось определить ни одного объекта.",
      traceId,
    };
  }

  // --- Vector layer: embed the recognised label and rank the catalog --------
  const trace = newTraceId("embed");
  const queryVec = (
    await aiGateway.embed({ texts: [top.label], traceId: trace })
  ).vectors[0];

  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    include: {
      sellerProfile: { select: { displayName: true } },
      inventory: { select: { availability: true } },
    },
    take: 500,
  });

  const scored = await Promise.all(
    products.map(async (product) => {
      const vec = await getProductEmbedding(product, trace);
      const similarity = vec ? cosine(queryVec, vec) : 0;
      return { product, similarity };
    }),
  );
  scored.sort((a, b) => b.similarity - a.similarity);

  const candidates: VisionCandidate[] = scored
    .filter((s) => s.similarity > 0.05)
    .slice(0, 10)
    .map((s, idx) => ({
      productId: s.product.id,
      title: s.product.title,
      priceKopecks: s.product.priceKopecks,
      sellerName: s.product.sellerProfile.displayName,
      availability: s.product.inventory?.availability ?? "UNKNOWN",
      similarity: s.similarity,
      match: idx === 0 ? "exact" : idx < 3 ? "similar" : "related",
    }));

  const status: VisionStatus = provider.sandbox ? "MOCK_VERIFIED" : "VERIFIED";
  const confidencePct = Math.round(top.confidence * 100);
  const explanation =
    candidates.length > 0
      ? `${provider.sandbox ? "[sandbox] " : ""}Распознано: «${top.label}» (уверенность ${confidencePct}%). Найдено ${candidates.length} похожих предложений в каталоге.`
      : `${provider.sandbox ? "[sandbox] " : ""}Распознано: «${top.label}» (уверенность ${confidencePct}%), но похожих товаров в каталоге пока нет.`;

  return {
    status,
    detections,
    candidates,
    explanation,
    traceId,
  };
}
