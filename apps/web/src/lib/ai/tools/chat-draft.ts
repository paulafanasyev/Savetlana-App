/**
 * Черновик карточки из чата: тот же инструмент create_product_draft, но
 * сначала исходное сообщение продавца разбирается составителем карточек
 * (lib/domains/chat-product-draft.ts). Сообщение берём из переписки по
 * traceId этого шага: так модель не может подменить текст продавца.
 * Вызовы не из чата (форма, список) идут без изменений.
 */
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { prisma } from "../../prisma";
import { chatDraftArgs, chatDraftReport, chatDraftSource, draftProductId } from "../../domains/chat-product-draft";

async function chatMessage(ctx: ToolContext): Promise<string> {
  if (!ctx.traceId || ctx.role === "guest") return "";
  try {
    const row = await prisma.aiMessage.findFirst({
      where: { role: "user", trace: { contains: `"traceId":"${ctx.traceId}"` }, conversation: { userId: ctx.userId } },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    return row?.content ?? "";
  } catch {
    return "";
  }
}

export function composingProductDraftTool(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
      if (!ctx.sellerProfileId) return tool.execute(ctx, args);
      const source = chatDraftSource(await chatMessage(ctx));
      if (!source) return tool.execute(ctx, args);
      const categories = await prisma.category.findMany({ select: { slug: true, name: true } });
      const next = chatDraftArgs(args, source, categories);
      if (!next) return tool.execute(ctx, args);
      const result = await tool.execute(ctx, next);
      if (!result.ok) return result;
      const categoryName = categories.find((c) => c.slug === next.categorySlug)?.name ?? null;
      // Ссылка на черновик: продавец сразу открывает его и добавляет фото.
      return { ...result, summary: chatDraftReport(next, categoryName, draftProductId(result.data)) };
    },
  };
}
