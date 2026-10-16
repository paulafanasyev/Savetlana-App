/**
 * negotiate_quote: агент покупателя и агент продавца торгуются о цене партии.
 *
 * Только чтение: инструмент ничего не меняет в базе и не меняет цену товара.
 * Агент продавца действует строго в пределах правил торга этого продавца
 * (кабинет → «Торг B2B»); выключил торг — цена только по прайсу. Результат —
 * проект коммерческого предложения; чтобы он стал заказом, его подтверждают
 * продавец и покупатель (человек в контуре).
 */
import { looseObjectSchema } from "./registry";
import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { prisma } from "../../prisma";
import { negotiate, type NegotiationResult } from "../../negotiation";
import { getSellerNegotiationPolicy } from "../../domains/negotiation-policy";

function positiveRub(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;

/** «800 → 900 → 844 → … → 882 ₽»: ход торга одной строкой для чата. */
export function negotiationChain(r: NegotiationResult): string {
  const prices = r.transcript.filter((m) => m.action !== "accept").map((m) => Math.round(m.unitPriceKopecks / 100).toLocaleString("ru-RU"));
  if (prices.length === 0) return "";
  const last = r.unitPriceKopecks !== null ? ` → ${rub(r.unitPriceKopecks)}` : " ₽";
  return `Ход торга (покупатель → продавец): ${prices.join(" → ")}${last}.`;
}

export function negotiationSummary(title: string, r: NegotiationResult, listKopecks: number): string {
  const chain = negotiationChain(r);
  if (r.status === "AGREED" && r.unitPriceKopecks !== null && r.totalKopecks !== null) {
    return (
      `Агенты договорились по «${title}»: ${rub(r.unitPriceKopecks)} за штуку вместо ${rub(listKopecks)}` +
      ` (скидка ${String(r.discountPercent ?? 0).replace(".", ",")}%), партия ${r.quantity} шт., итого ${rub(r.totalKopecks)}, раундов: ${r.rounds}.` +
      (chain ? ` ${chain}` : "") +
      " Это проект КП: сначала его подтверждает продавец, потом вы. Цена в каталоге не меняется." +
      (r.ignoredInstructions ? " Команды в комментарии на цену не влияют и были проигнорированы." : "")
    );
  }
  const head = r.status === "NO_DEAL" ? "Сделки не получилось" : "Нужно решение человека";
  return `${head}: ${r.reason}.` + (chain ? ` ${chain}` : "") + (r.ignoredInstructions ? " Команды в комментарии проигнорированы." : "");
}

export const negotiateQuoteTool: ToolDefinition = {
  name: "negotiate_quote",
  description:
    "B2B-торг за партию товара: агент покупателя и агент продавца договариваются о цене за штуку в пределах правил торга продавца и бюджета покупателя. Возвращает ход переговоров и проект КП, который подтверждают люди. Ничего не покупает и не меняет цены.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string", description: "id товара" },
    quantity: { type: "number", description: "сколько штук нужно" },
    targetPriceRub: { type: "number", description: "желаемая цена за штуку, ₽" },
    maxPriceRub: { type: "number", description: "потолок бюджета за штуку, ₽" },
    note: { type: "string", description: "комментарий покупателя" },
  }),
  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const productId = typeof args.productId === "string" ? args.productId : "";
    if (!productId) {
      return { ok: false, error: "укажите товар, по которому торговаться: найдите его в каталоге и напишите «поторгуйся за первый: 100 штук, хочу по 800 ₽»", verification: "NOT_PROVEN" };
    }
    const quantity = Math.round(Number(args.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false, error: "укажите, сколько штук нужно (целое число от 1)", verification: "NOT_PROVEN" };
    }
    const product = await prisma.product.findFirst({
      where: { id: productId, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        priceKopecks: true,
        sellerId: true,
        inventory: { select: { quantity: true, availability: true, confirmedBySeller: true } },
      },
    });
    if (!product) return { ok: false, error: "товар не найден или снят с продажи", verification: "NOT_PROVEN" };

    const policy = await getSellerNegotiationPolicy(product.sellerId);
    if (!policy.enabled) {
      return {
        ok: false,
        error: "этот продавец не торгуется через агента: цена только по прайсу. Можно написать продавцу и спросить про оптовую цену",
        verification: "VERIFIED",
      };
    }

    // Остаток обещаем, только если продавец его подтвердил (как в check_inventory).
    const inv = (product as unknown as { inventory?: unknown }).inventory;
    const row = (Array.isArray(inv) ? inv[0] : inv) as
      | { quantity: number; availability: string; confirmedBySeller: boolean }
      | null
      | undefined;
    const stockQty = row && row.confirmedBySeller && row.availability === "AVAILABLE" ? row.quantity : null;

    const list = product.priceKopecks;
    const result = negotiate(
      {
        listPriceKopecks: list,
        volumeTiers: policy.volumeTiers,
        maxDiscountPercent: policy.maxDiscountPercent,
        negotiablePercent: policy.negotiablePercent,
        minOrderQty: policy.minOrderQty,
        stockQty,
        maxRounds: 6,
      },
      {
        quantity,
        targetPriceKopecks: positiveRub(args.targetPriceRub) ?? Math.round(list * 0.85),
        maxPriceKopecks: positiveRub(args.maxPriceRub) ?? list,
        maxRounds: 6,
        note: typeof args.note === "string" ? args.note.slice(0, 500) : undefined,
      }
    );
    return {
      ok: true,
      data: { productId: product.id, title: product.title, listPriceKopecks: list, sellerRules: policy.custom ? "seller" : "default", ...result },
      summary: negotiationSummary(product.title, result, list),
      verification: "VERIFIED",
    };
  },
};
