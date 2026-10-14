/**
 * Проверка сообщения перед отправкой: правила scam-guard + учёт в рисках.
 *
 * block — сообщение не уходит, отправитель видит причину, в RiskEvent пишется
 *         факт (только коды правил, без текста переписки). Три блокировки за
 *         сутки поднимают уровень до REVIEW: аккаунт стоит проверить вручную.
 * warn  — сообщение уходит, получателю отдельно приходит предупреждение.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { notify } from "./notifications";
import { UserFacingError } from "./engagement-rules";
import { explainVerdict, scanMessage, type ScamVerdict } from "./scam-guard";

/** Предупреждения о мошенничестве идут как уведомления безопасности. */
export const SAFETY_WARNING_KIND = "security" as const;

function ownDomains(): string[] {
  try {
    return [new URL(env.publicAppUrl).hostname];
  } catch {
    return [];
  }
}

/** Бросает UserFacingError, если сообщение опасное; иначе возвращает вердикт. */
export async function guardOutgoingMessage(senderId: string, text: string): Promise<ScamVerdict> {
  const verdict = scanMessage(text, { ownDomains: ownDomains() });
  if (verdict.verdict === "ok") return verdict;
  const codes = verdict.findings.map((f) => f.code);

  if (verdict.verdict === "block") {
    const recent = await prisma.riskEvent.count({
      where: { actorType: "user", actorId: senderId, ruleId: { in: ["M1_scam_message_blocked", "M2_repeated_scam_messages"] }, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    const repeated = recent + 1 >= 3;
    await prisma.riskEvent.create({
      data: {
        actorType: "user",
        actorId: senderId,
        level: repeated ? "REVIEW" : "HIGH",
        ruleId: repeated ? "M2_repeated_scam_messages" : "M1_scam_message_blocked",
        description: repeated ? "повторные попытки отправить мошенническое сообщение" : "сообщение с признаками мошенничества не отправлено",
        signals: JSON.stringify({ codes, blockedLast24h: recent + 1 }),
        explanation: explainVerdict(verdict),
        actionTaken: repeated ? "manual_review" : "message_blocked",
      },
    });
    throw new UserFacingError(`Сообщение не отправлено. ${explainVerdict(verdict)}.`, 422);
  }

  await prisma.riskEvent.create({
    data: {
      actorType: "user",
      actorId: senderId,
      level: "MEDIUM",
      ruleId: "M0_message_warning",
      description: "сообщение с подозрительными признаками отправлено с предупреждением",
      signals: JSON.stringify({ codes }),
      explanation: explainVerdict(verdict),
      actionTaken: "warn_recipient",
    },
  });
  return verdict;
}

/** Предупреждение получателю рядом с подозрительным сообщением. */
export async function warnRecipient(recipientId: string, verdict: ScamVerdict, threadUrl: string): Promise<void> {
  if (verdict.verdict !== "warn") return;
  await notify({
    userId: recipientId,
    kind: SAFETY_WARNING_KIND,
    title: "Осторожно: возможное мошенничество",
    body: `${explainVerdict(verdict)}. Платите только кнопкой «Оплатить» на площадке и никому не называйте коды из СМС.`,
    url: threadUrl,
  });
}
