/**
 * Social & memory tools: gifts, relationship graph and personal memory.
 *
 * Relationship data is only ever exposed when the underlying link is
 * VERIFIED by both sides — SUGGESTED links stay invisible to agents (spec §16).
 */
import { suggestGifts, upcomingGiftEvents, getGiftContext } from "../../domains/gifts";
import {
  declareRelationship,
  getVerifiedCircle,
  RELATIONSHIP_TYPES,
} from "../../domains/relationships";
import { rememberStated, rememberInference, getMemory } from "../../domains/memory";
import { prisma } from "../../prisma";
import { fromKopecks } from "../../utils";
import type { ToolDefinition, ToolResult, ToolContext } from "./registry";
import { looseObjectSchema } from "./registry";

function ok(data: unknown, summary: string): ToolResult {
  return { ok: true, data, summary, verification: "VERIFIED" };
}
function denied(reason: string): ToolResult {
  return { ok: false, error: reason, verification: "NOT_PROVEN" };
}

export const planGiftTool: ToolDefinition = {
  name: "plan_gift",
  description:
    "Подобрать подарок: учитывает интересы, бюджет, wishlist и уже подаренное. Использует только разрешённые данные.",
  permission: "GIFT_WRITE",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    occasion: { type: "string" },
    recipientName: { type: "string" },
    budget: { type: "number" },
    note: { type: "string" },
    eventId: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // Existing event: use its stored budget/interests (the user already
    // consented to that data being used for gifting).
    if (typeof args.eventId === "string") {
      const { suggestions, excludedPreviouslyGifted } = await suggestGifts(args.eventId, 6);
      return ok(
        { suggestions, excludedPreviouslyGifted },
        suggestions.length > 0
          ? `Подобрала ${suggestions.length} вариантов. Первый: «${suggestions[0].title}» за ${fromKopecks(suggestions[0].priceKopecks)} ₽.`
          : "В рамках бюджета и интересов ничего не нашлось."
      );
    }

    const recipientName =
      typeof args.recipientName === "string" && args.recipientName.trim().length > 0
        ? args.recipientName.trim()
        : null;
    if (!recipientName) return denied("укажите, кому подарок");
    const budget = typeof args.budget === "number" && args.budget > 0 ? args.budget : undefined;

    // Create a draft gift event the user can edit in the Gift Center.
    const event = await prisma.giftEvent.create({
      data: {
        creatorId: ctx.userId,
        recipientName,
        recipientRelationship:
          typeof args.occasion === "string" ? args.occasion.slice(0, 60) : null,
        occasion: typeof args.occasion === "string" ? args.occasion.slice(0, 100) : "custom",
        // No date supplied yet: the user sets it in the Gift Center.
        eventDate: new Date(Date.now() + 14 * 864e5),
        interests: JSON.stringify([]),
        budgetKopecks: budget ? Math.round(budget * 100) : 0,
        status: "DRAFT",
      },
    });
    const { suggestions } = await suggestGifts(event.id, 6);
    return ok(
      { eventId: event.id, suggestions },
      suggestions.length > 0
        ? `Подобрала ${suggestions.length} вариантов для «${recipientName}».`
        : "Пока ничего не нашлось — уточните интересы или бюджет."
    );
  },
};

export const upcomingEventsTool: ToolDefinition = {
  name: "upcoming_events",
  description: "Приближающиеся события, по которым пользователь просил напоминания.",
  permission: "GIFT_WRITE",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ withinDays: { type: "number" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const within = typeof args.withinDays === "number" ? args.withinDays : 14;
    const events = await upcomingGiftEvents(ctx.userId, within);
    return ok(
      { events },
      events.length > 0
        ? `Ближайших событий: ${events.length}. Первое: ${events[0].recipientName}, ${events[0].eventDate.toLocaleDateString("ru-RU")}.`
        : "В ближайшее время событий нет."
    );
  },
};

export const giftContextTool: ToolDefinition = {
  name: "gift_context",
  description:
    "Контекст подарков: только подтверждённые связи и сохранённые события. Предложения не учитываются.",
  permission: "GIFT_WRITE",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const context = await getGiftContext(ctx.userId);
    return ok(context, "Контекст собран. Используются только подтверждённые связи.");
  },
};

export const declareRelationshipTool: ToolDefinition = {
  name: "declare_relationship",
  description:
    "Объявить связь с другим человеком. Становится PENDING_CONFIRMATION — факт только после подтверждения второй стороной.",
  permission: "RELATIONSHIP_WRITE",
  riskLevel: "LOW_RISK_WRITE",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    toUserId: { type: "string" },
    type: { type: "string" },
    note: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const toUserId = typeof args.toUserId === "string" ? args.toUserId : null;
    const type = typeof args.type === "string" ? args.type.toUpperCase() : null;
    if (!toUserId) return denied("укажите toUserId");
    if (!type || !RELATIONSHIP_TYPES.includes(type as never)) {
      return denied(`допустимые типы связи: ${RELATIONSHIP_TYPES.join(", ")}`);
    }
    const result = await declareRelationship(
      ctx.userId,
      toUserId,
      type,
      typeof args.note === "string" ? args.note.slice(0, 300) : undefined
    );
    return ok(
      {
        relationshipId: result.relationship.id,
        status: result.relationship.status,
        confirmationId: result.confirmationId,
        alreadyVerified: result.alreadyVerified,
      },
      result.alreadyVerified
        ? "Связь уже подтверждена обеими сторонами."
        : "Связь отправлена на подтверждение. Фактом она станет после ответа второй стороны."
    );
  },
};

export const verifiedCircleTool: ToolDefinition = {
  name: "verified_circle",
  description:
    "Подтверждённый круг пользователя. SUGGESTED и DECLARED связи не возвращаются — они не факты.",
  permission: "READ_PROFILE",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const circle = await getVerifiedCircle(ctx.userId);
    return ok(
      { circle },
      circle.length > 0
        ? `Подтверждённых связей: ${circle.length}.`
        : "Подтверждённых связей пока нет."
    );
  },
};

export const rememberPreferenceTool: ToolDefinition = {
  name: "remember_preference",
  description:
    "Сохранить факт или предпочтение пользователя в память. Пользователь видит и может удалить любую запись.",
  permission: "WRITE_MEMORY",
  riskLevel: "LOW_RISK_WRITE",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    key: { type: "string" },
    value: { type: "string" },
    type: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const key = typeof args.key === "string" ? args.key : null;
    const value = typeof args.value === "string" ? args.value : null;
    if (!key || !value) return denied("укажите key и value");
    const type =
      args.type === "FACT" || args.type === "TEMPORARY_CONTEXT" ? args.type : "PREFERENCE";
    try {
      const entry = await rememberStated(ctx.userId, type, key, value.slice(0, 500));
      return ok({ id: entry.id, key: entry.key }, `Запомнила: ${key} = ${value.slice(0, 60)}.`);
    } catch (e) {
      return denied(e instanceof Error ? e.message : "не удалось сохранить");
    }
  },
};

export const recallMemoryTool: ToolDefinition = {
  name: "recall_memory",
  description: "Вспомнить сохранённые предпочтения и факты пользователя.",
  permission: "READ_MEMORY",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const entries = await getMemory(ctx.userId);
    return ok(
      { entries: entries.map((e) => ({ id: e.id, type: e.type, key: e.key, value: e.value })) },
      entries.length > 0
        ? `Помню ${entries.length} фактов о ваших предпочтениях.`
        : "Пока ничего не сохранено."
    );
  },
};

export { rememberInference };
