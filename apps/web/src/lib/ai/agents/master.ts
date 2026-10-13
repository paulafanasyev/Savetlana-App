/**
 * Svetlana Master Agent (spec §3, §5, §153).
 *
 * User → Svetlana → Intent → Planner → Policy → Tools → Agents →
 *   External systems → Verification → Svetlana → User
 *
 * The master agent never touches the database directly: every state change
 * goes through the tool registry, which enforces role permissions,
 * confirmation gating and audit logging. It verifies each tool result before
 * it is allowed to claim success, and reports honest verification labels
 * (VERIFIED / NOT_PROVEN / PENDING_EXTERNAL_ACCESS) rather than asserting
 * outcomes (spec §47, §58, §148).
 */
import { aiGateway, aiMode, newTraceId } from "../gateway";
import { toolRegistry, confirmPreview } from "../tools";
import { registerAllTools } from "../tools";
import { permissionsForRole } from "../tools/registry";
import { routeAgent, AGENT_TOOLS, type AgentKey } from "./router";
import { decide, AGENT_LIMITS, PolicyAssertionError } from "./policy";
import { prisma } from "../../prisma";
import { createPendingAction, consumePendingAction } from "../../domains/pending-actions";
import { integrationStatus, hasExternalAiCredentials } from "../../env";
import type { AiMessage, AiToolDefinition } from "../types";
import type { ToolContext, ToolResult } from "../tools/registry";
import { chooseShown, extractShownItems, planReferenceAction, resolveToolArgs, shownContext, type ShownItem } from "../references";

// Register the tool catalogue once at first use.
registerAllTools();

/** Пометка, когда внешняя модель настроена, но не ответила и ответил встроенный движок. */
export const FALLBACK_NOTE = "(Внешний ИИ сейчас не ответил, поэтому отвечает встроенная Светлана.)";

/**
 * Гость (без входа): переписка не сохраняется, доступны только поиск,
 * сравнение и отзывы. Заказы, корзина и любые изменения требуют входа.
 */
export const GUEST_CONVERSATION = "guest";
const GUEST_BLOCKED_TOOLS = new Set(["check_vin"]);
const GUEST_LOGIN_TEXT =
  "это доступно после входа в аккаунт (кнопка «Войти» вверху страницы). Без входа я могу искать товары, сравнивать их и показывать отзывы";

export interface MasterAgentInput {
  userId: string;
  message: string;
  role: "buyer" | "seller" | "specialist" | "admin" | "guest";
  sellerProfileId?: string;
  conversationId?: string;
  /** UI-supplied confirmations for pending sensitive actions. */
  confirmations?: Record<string, boolean>;
}

export interface AgentStep {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
}

export interface MasterAgentResult {
  answer: string;
  conversationId: string;
  agent: AgentKey;
  /** True only if a real (non-sandbox) model produced the final answer. */
  liveModel: boolean;
  /** External model is configured but the final answer came from the built-in engine. */
  degraded?: boolean;
  steps: AgentStep[];
  verification: "VERIFIED" | "MOCK_VERIFIED" | "NOT_PROVEN" | "PENDING_EXTERNAL_ACCESS";
  /** A sensitive action is waiting on the user's explicit confirmation. */
  pendingConfirmation?: {
    toolName: string;
    args: Record<string, unknown>;
    reason: string;
    /** Opaque single-use handle; the client echoes only this back (P0 fix). */
    actionId: string;
    nonce: string;
    expiresAt: string;
  };
  traceId: string;
}

const SYSTEM_PROMPT = [
  "Ты — Светлана, главный AI-помощник платформы.",
  "Обращайся к пользователю на «вы», вежливо и по делу.",
  "Ты видишь перед собой только безопасный контекст: никакие секреты, платёжные реквизиты и чужие персональные данные тебе не передаются.",
  "Если данных недостаточно — честно скажи, чего не хватает, вместо того чтобы придумывать.",
  "Никогда не утверждай, что действие выполнено, если инструмент не вернул реальный результат.",
  "Доставка на площадке: самовывоз у продавца (бесплатно) или доставка продавцом (350 ₽). Оплата на странице заказа. Проблемы с заказом решаются кнопкой «Открыть спор» на странице заказа.",
].join(" ");

function buildToolSchemas(names: string[]): AiToolDefinition[] {
  return names
    .map((n) => toolRegistry.get(n))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
}

export class SvetlanaMasterAgent {
  async run(input: MasterAgentInput): Promise<MasterAgentResult> {
    const traceId = newTraceId("sv");
    const guest = input.role === "guest";
    const conversationId = guest ? GUEST_CONVERSATION : input.conversationId ?? (await this.createConversation(input));
    const routing = routeAgent(input.message, input.role === "seller" ? "seller" : "buyer");
    const ctx: ToolContext = {
      userId: input.userId,
      role: input.role,
      sellerProfileId: input.sellerProfileId,
      traceId,
      confirm: async (toolName, args) => {
        const key = confirmationKey(toolName, args);
        return input.confirmations?.[key] === true;
      },
    };

    await this.persistMessage(conversationId, "user", input.message, {
      traceId,
      agent: routing.agent,
    });

    const history = await this.loadHistory(conversationId);
    // Короткая память разговора: какие товары Светлана только что показала,
    // чтобы понимать «сравни эти два» и «добавь первый в корзину».
    const shown = chooseShown(await this.recentShownLists(conversationId), input.message);
    // The user message is added ONCE. Tool results are appended after it, so
    // a model that has already acted must now react to the results instead of
    // re-decoding the same intent forever (loop protection, spec §145).
    const messages: AiMessage[] = [
      { role: "system", content: shown.length > 0 ? `${SYSTEM_PROMPT} ${shownContext(shown)}` : SYSTEM_PROMPT },
      ...history,
      { role: "user", content: input.message },
    ];
    const steps: AgentStep[] = [];
    let pendingConfirmation: MasterAgentResult["pendingConfirmation"];
    let lastAnswer = "";
    let anyLive = false;
    let finalLive = false;
    let answeredByModel = false;

    // Явная ссылка на показанные товары выполняется сразу, точно по ним, а
    // модель затем отвечает по результату (как после обычного вызова).
    const shortcut = planReferenceAction(input.message, shown);
    if (shortcut) {
      const call = { id: `call_${traceId}_ref`, name: shortcut.tool, arguments: shortcut.args };
      messages.push({ role: "assistant", content: shortcut.label, toolCalls: [call] });
      const outcome = await this.executeTool(call.name, call.arguments, ctx, routing.agent, conversationId);
      if (outcome.kind === "awaiting_confirmation") {
        pendingConfirmation = outcome.pending;
        lastAnswer = outcome.message;
      } else {
        steps.push(outcome.step);
        messages.push({ role: "tool", content: JSON.stringify(outcome.step.result), toolCallId: call.id });
      }
    }

    for (let step = 0; step < AGENT_LIMITS.maxSteps; step++) {
      if (pendingConfirmation) break;
      if (steps.length >= AGENT_LIMITS.maxToolCalls) break;

      const toolNames = AGENT_TOOLS[routing.agent] ?? [];
      const gatewayResult = await aiGateway.complete({
        messages,
        tools: buildToolSchemas(toolNames),
        taskClass: "reasoning",
        traceId: `${traceId}_s${step}`,
      });
      anyLive = anyLive || gatewayResult.live;
      const response = gatewayResult.response;

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Only the calls we will actually execute go into the transcript: an
        // OpenAI-compatible API rejects a tool_call that has no tool result.
        const budget = Math.max(0, AGENT_LIMITS.maxToolCalls - steps.length);
        const calls = response.toolCalls.slice(0, budget).map((call, index) => ({
          ...call,
          id: call.id || `call_${traceId}_${step}_${index}`,
          arguments: resolveToolArgs(call.name, call.arguments ?? {}, input.message, shown),
        }));
        if (calls.length === 0) break;
        // The assistant turn that requested the tools must precede their results.
        messages.push({ role: "assistant", content: response.content ?? "", toolCalls: calls });
        for (const call of calls) {
          const outcome = await this.executeTool(call.name, call.arguments, ctx, routing.agent, conversationId);
          if (outcome.kind === "awaiting_confirmation") {
            pendingConfirmation = outcome.pending;
            lastAnswer = outcome.message;
            break;
          }
          steps.push(outcome.step);
          messages.push({
            role: "tool",
            content: JSON.stringify(outcome.step.result),
            toolCallId: call.id,
          });
        }
        if (pendingConfirmation) break;
        // Loop again so the model can react to the tool results.
        continue;
      }

      lastAnswer = response.content;
      finalLive = gatewayResult.live;
      answeredByModel = true;
      break;
    }

    if (!lastAnswer) {
      lastAnswer = steps.length
        ? "Я собрала данные, но сформулировать итоговый ответ не смогла. Вот что удалось узнать: " +
          steps.map((s) => s.result.summary ?? s.toolName).join("; ")
        : "Мне не удалось обработать запрос. Попробуйте переформулировать или написать название товара.";
    }

    // Honest provenance: the label follows whoever wrote the final answer,
    // not whoever answered first.
    const liveModel = answeredByModel ? finalLive : anyLive;
    const degraded = hasExternalAiCredentials && answeredByModel && !finalLive;
    if (degraded) lastAnswer = `${lastAnswer}\n\n${FALLBACK_NOTE}`;

    const verification = deriveVerification(steps, liveModel);
    await this.persistMessage(conversationId, "assistant", lastAnswer, {
      traceId,
      agent: routing.agent,
      provider: aiMode().provider,
      verification,
      degraded,
      steps: steps.map((s) => s.toolName),
    });

    return {
      answer: lastAnswer,
      conversationId,
      agent: routing.agent,
      liveModel,
      degraded,
      steps,
      verification,
      pendingConfirmation,
      traceId,
    };
  }

  private async createConversation(input: {
    userId: string;
    role: string;
    message?: string;
    sellerProfileId?: string;
  }): Promise<string> {
    const conv = await prisma.aiConversation.create({
      data: {
        userId: input.userId,
        title: (input.message ?? "Подтверждённое действие").slice(0, 80),
        context: JSON.stringify({
          role: input.role,
          sellerProfileId: input.sellerProfileId,
        }),
      },
    });
    return conv.id;
  }

  private async loadHistory(conversationId: string): Promise<AiMessage[]> {
    if (conversationId === GUEST_CONVERSATION) return [];
    const rows = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    // Only plain user/assistant turns are replayed: a stored tool row has no
    // matching tool_call and would make an external API reject the request.
    return rows
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => ({
        role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: r.content,
      }));
  }

  /** Товары из последних успешных вызовов инструментов этого разговора, новые первыми. */
  private async recentShownLists(conversationId: string): Promise<ShownItem[][]> {
    if (conversationId === GUEST_CONVERSATION) return [];
    try {
      const rows = await prisma.aiToolCall.findMany({
        where: { conversationId, status: "success" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { output: true },
      });
      return rows.map((r) => extractShownItems(String(r.output ?? ""))).filter((list) => list.length > 0);
    } catch {
      return [];
    }
  }

  private async persistMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    trace: Record<string, unknown>
  ): Promise<void> {
    if (conversationId === GUEST_CONVERSATION) return;
    try {
      await prisma.aiMessage.create({
        data: {
          conversationId,
          role,
          content: content.slice(0, 8000),
          trace: JSON.stringify(trace),
          providerUsed: typeof trace.provider === "string" ? trace.provider : null,
          agentUsed: typeof trace.agent === "string" ? trace.agent : null,
          verification: typeof trace.verification === "string" ? trace.verification : "NOT_PROVEN",
        },
      });
    } catch {
      // Persistence must not break the conversation.
    }
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    agentName: AgentKey,
    conversationId: string
  ): Promise<
    | { kind: "done"; step: AgentStep }
    | { kind: "awaiting_confirmation"; pending: MasterAgentResult["pendingConfirmation"]; message: string }
  > {
    const started = Date.now();
    const def = toolRegistry.get(name);
    if (!def) {
      const step: AgentStep = {
        toolName: name,
        args,
        result: { ok: false, error: `инструмент не существует: ${name}`, verification: "NOT_PROVEN" },
        durationMs: Date.now() - started,
      };
      await this.logToolCall(conversationId, agentName, name, args, step, "denied");
      return { kind: "done", step };
    }

    // Гостю доступно только чтение каталога; всё остальное вежливо предлагаем сделать после входа.
    if (
      ctx.role === "guest" &&
      (def.needsConfirmation || GUEST_BLOCKED_TOOLS.has(name) || !permissionsForRole("guest").includes(def.permission))
    ) {
      return {
        kind: "done",
        step: {
          toolName: name,
          args,
          result: { ok: false, error: GUEST_LOGIN_TEXT, verification: "NOT_PROVEN" },
          durationMs: Date.now() - started,
        },
      };
    }

    // A confirmation-gated tool that the user has not confirmed becomes a
    // pending confirmation — NOT a silent denial, and NOT an endless retry
    // (spec §45, §147). The action is persisted server-side and the client
    // only ever receives an opaque handle, so it cannot forge a different
    // (toolName, args) pair on confirm.
    const alreadyConfirmed = ctx.confirm ? await ctx.confirm(name, args) : false;
    if (def.needsConfirmation && !alreadyConfirmed) {
      // Перед подтверждением показываем, что именно изменится. Если действие
      // выполнить нельзя, сразу говорим причину вместо кнопки «Подтвердить».
      const preview = await confirmPreview(name, ctx, args).catch(() => null);
      if (preview && !preview.ok) {
        const step: AgentStep = {
          toolName: name,
          args,
          result: { ok: false, error: preview.error, verification: "NOT_PROVEN" },
          durationMs: Date.now() - started,
        };
        await this.logToolCall(conversationId, agentName, name, args, step, "denied");
        return { kind: "done", step };
      }
      const pending = await persistPending(ctx, conversationId, name, args, def.riskLevel);
      if (pending) {
        await this.logToolCall(conversationId, agentName, name, args, null, "requires_confirmation");
        return {
          kind: "awaiting_confirmation",
          pending: pending.descriptor,
          message: preview?.ok
            ? `${preview.text}\nНажмите «Подтвердить действие», и я это сделаю.`
            : `${pending.descriptor.reason}. Подтвердите действие «${name}», и я его выполню.`,
        };
      }
      const step: AgentStep = {
        toolName: name,
        args,
        result: { ok: false, error: "не удалось зарегистрировать подтверждение", verification: "NOT_PROVEN" },
        durationMs: Date.now() - started,
      };
      await this.logToolCall(conversationId, agentName, name, args, step, "error");
      return { kind: "done", step };
    }

    const authorization = await toolRegistry.authorize(name, ctx, args);
    if (!authorization.allowed) {
      const step: AgentStep = {
        toolName: name,
        args,
        result: { ok: false, error: authorization.reason, verification: "NOT_PROVEN" },
        durationMs: Date.now() - started,
      };
      await this.logToolCall(conversationId, agentName, name, args, step, "denied");
      return { kind: "done", step };
    }

    const tool = authorization.tool;
    const policy = decide(tool.riskLevel, alreadyConfirmed);
    if (policy.decision === "needs_user_confirmation") {
      const pending = await persistPending(ctx, conversationId, name, args, tool.riskLevel);
      if (pending) {
        await this.logToolCall(conversationId, agentName, name, args, null, "requires_confirmation");
        return {
          kind: "awaiting_confirmation",
          pending: pending.descriptor,
          message: `${policy.reason}. Подтвердите выполнение действия «${name}», и я его выполню.`,
        };
      }
      const step: AgentStep = {
        toolName: name,
        args,
        result: { ok: false, error: "не удалось зарегистрировать подтверждение", verification: "NOT_PROVEN" },
        durationMs: Date.now() - started,
      };
      await this.logToolCall(conversationId, agentName, name, args, step, "error");
      return { kind: "done", step };
    }

    let result: ToolResult;
    try {
      result = await tool.execute(ctx, args);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        verification: "NOT_PROVEN",
      };
    }
    const step: AgentStep = {
      toolName: name,
      args,
      result,
      durationMs: Date.now() - started,
    };
    await this.logToolCall(
      conversationId,
      agentName,
      name,
      args,
      step,
      result.ok ? "success" : "error"
    );
    return { kind: "done", step };
  }

  private async logToolCall(
    conversationId: string,
    agentName: AgentKey,
    toolName: string,
    args: Record<string, unknown>,
    step: AgentStep | null,
    status: string
  ): Promise<void> {
    if (conversationId === GUEST_CONVERSATION) return;
    try {
      const def = toolRegistry.get(toolName);
      await prisma.aiToolCall.create({
        data: {
          conversationId,
          toolName,
          agentName,
          permission: def?.permission ?? "unknown",
          riskLevel: def?.riskLevel ?? "READ",
          input: JSON.stringify(args).slice(0, 2000),
          output: step ? JSON.stringify(step.result).slice(0, 4000) : "{}",
          status,
          durationMs: step?.durationMs,
          errorMessage: step?.result.error?.slice(0, 500),
          executedById: step?.result.ok ? undefined : undefined,
        },
      });
    } catch {
      // Observability must not break the flow.
    }
  }

  async executeConfirmed(
    input: Omit<MasterAgentInput, "message">,
    claim: { actionId: string; nonce: string }
  ): Promise<MasterAgentResult> {
    const traceId = newTraceId("sv");
    const conversationId = input.conversationId ?? (await this.createConversation(input));

    // The claim is redeemed server-side: the user must be the owner, the
    // nonce must match, the row must still be PENDING and unexpired. This is
    // what makes "I confirmed this" provable instead of trust-on-client.
    const claimResult = await consumePendingAction({
      userId: input.userId,
      actionId: claim.actionId,
      nonce: claim.nonce,
      conversationId: input.conversationId,
    });
    if (!claimResult.ok || !claimResult.action) {
      const answer = claimResult.error ?? "Подтверждение недействительно";
      const convId = conversationId;
      await this.persistMessage(convId, "assistant", answer, {
        traceId,
        agent: "buyer",
        provider: aiMode().provider,
        verification: "NOT_PROVEN",
        confirmedByUser: true,
        confirmationRejected: true,
      });
      return {
        answer,
        conversationId: convId,
        agent: "buyer",
        liveModel: false,
        steps: [],
        verification: "NOT_PROVEN",
        traceId,
      };
    }

    const action = claimResult.action;
    const routing = routeAgent("подтверждение действия", input.role === "seller" ? "seller" : "buyer");
    const ctx: ToolContext = {
      userId: input.userId,
      role: input.role,
      sellerProfileId: input.sellerProfileId,
      traceId,
      // The stored action was already gated; the policy layer now sees a
      // legitimately consumed confirmation bound to this exact call.
      confirm: async (toolName, args) =>
        toolName === action.toolName &&
        confirmationKey(toolName, args) === confirmationKey(toolName, action.args),
    };
    const outcome = await this.executeTool(
      action.toolName,
      action.args,
      ctx,
      routing.agent,
      conversationId
    );
    const steps: AgentStep[] = [];
    if (outcome.kind === "done") steps.push(outcome.step);

    const answer = outcome.kind === "awaiting_confirmation"
      ? "Действие всё ещё требует подтверждения."
      : outcome.step.result.ok
        ? outcome.step.result.summary ?? "Готово — действие выполнено и проверено."
        : `Не получилось: ${outcome.step.result.error ?? "причина неизвестна"}`;

    const verification = steps.length === 0 || !steps[0].result.ok
      ? "NOT_PROVEN"
      : steps[0].result.verification === "VERIFIED"
        ? "VERIFIED"
        : "MOCK_VERIFIED";

    await this.persistMessage(conversationId, "assistant", answer, {
      traceId,
      agent: routing.agent,
      provider: aiMode().provider,
      verification,
      steps: steps.map((st) => st.toolName),
      confirmedByUser: true,
    });

    return {
      answer,
      conversationId,
      agent: routing.agent,
      liveModel: false,
      steps,
      verification,
      traceId,
    };
  }
}

function confirmationKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

const CONFIRM_REASON = "это чувствительное действие — требуется ваше подтверждение";

/**
 * Binds the gated action to (user, conversation) server-side and returns the
 * opaque descriptor the UI may echo back. The args never round-trip through
 * the client, so a forged confirm cannot substitute different arguments.
 */
async function persistPending(
  ctx: ToolContext,
  conversationId: string,
  toolName: string,
  args: Record<string, unknown>,
  riskLevel: string
): Promise<{ descriptor: NonNullable<MasterAgentResult["pendingConfirmation"]> } | null> {
  try {
    const stored = await createPendingAction({
      userId: ctx.userId,
      conversationId,
      toolName,
      args,
      riskLevel,
    });
    return {
      descriptor: {
        toolName,
        args,
        reason: CONFIRM_REASON,
        actionId: stored.actionId,
        nonce: stored.nonce,
        expiresAt: stored.expiresAt.toISOString(),
      },
    };
  } catch {
    // Persistence failing must not become a silent bypass.
    return null;
  }
}

function deriveVerification(
  steps: AgentStep[],
  liveModel: boolean
): MasterAgentResult["verification"] {
  if (steps.length === 0) {
    return liveModel ? "VERIFIED" : "MOCK_VERIFIED";
  }
  const anyFailed = steps.some((s) => !s.result.ok);
  if (anyFailed) return "NOT_PROVEN";
  const allVerified = steps.every((s) => s.result.verification === "VERIFIED");
  if (!allVerified) return "MOCK_VERIFIED";
  return liveModel ? "VERIFIED" : "MOCK_VERIFIED";
}

export const masterAgent = new SvetlanaMasterAgent();

/**
 * Honest integration status surfaced to the UI and reports. Nothing here is
 * claimed working without a credential check.
 */
export function integrationReport(): Record<string, string> {
  return { ...integrationStatus };
}

export { PolicyAssertionError };
