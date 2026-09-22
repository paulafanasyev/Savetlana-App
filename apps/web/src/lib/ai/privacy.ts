/**
 * Privacy guard / data-leak protection (spec §83, §84, §85, §22).
 *
 * Everything the agent sends to an external model passes through here first.
 * The job: send the minimum necessary, never secrets, never PII without a
 * legal basis. The external provider is a processor, not the source of truth,
 * and must never see the whole database.
 */
import { prisma } from "../prisma";

/** Categories used to decide what may leave the platform. */
export type DataClass =
  | "PUBLIC" // catalog titles, prices, descriptions — already public
  | "PERSONAL" // names, contacts — needs a basis, redacted by default
  | "SENSITIVE_FINANCIAL" // cards, accounts, payouts — never leaves
  | "SECRET" // api keys, tokens, passwords — never leaves
  | "PRIVATE_CONTENT"; // private messages, closed documents — never leaves

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/i, // sk_live_…, pk_test_…
  /\b(?:sk|pk|ak|rk)_[A-Za-z0-9]{20,}\b/i, // other key prefixes
  /\bAI_GATEWAY_API_KEY[=:].*/i,
  // "Bearer <jwt>" (space) and "Authorization: <jwt>" (colon) both occur in
  // real headers — matching only "=" would leak both.
  /\b(?:Bearer|Authorization)[:\s]+[A-Za-z0-9\-_.]{20,}/i,
  /\bjwt_secret[=:].*/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
];

const FINANCIAL_PATTERNS: RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/, // card numbers
  /\b(?:\d{4}[ ]?){3}\d{1,4}\b/,
  // No \b before Cyrillic — an ASCII word boundary never matches at the start
  // of a Cyrillic word, so "счёт …" would slip through as PUBLIC.
  /(?:сч[её]т|расч[её]тный сч[её]т|БИК|КПП|корр\.?\s?сч[её]т)[:\s]*[A-Za-z0-9\s\-]{6,}/i,
  /\b4\d{3}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/,
];

const PERSONAL_PATTERNS: RegExp[] = [
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, // email
  /\b\+?7[\d\s\-\(\)]{10,18}\b/, // RU phone
  /\b8[\d\s\-\(\)]{10,18}\b/,
];

export interface ClassificationResult {
  dataClass: DataClass;
  findings: string[];
}

export function classifyText(text: string): ClassificationResult {
  const findings: string[] = [];
  if (SECRET_PATTERNS.some((re) => re.test(text))) {
    findings.push("secret-like-token");
    return { dataClass: "SECRET", findings };
  }
  if (FINANCIAL_PATTERNS.some((re) => re.test(text))) {
    findings.push("financial-credentials");
    return { dataClass: "SENSITIVE_FINANCIAL", findings };
  }
  if (PERSONAL_PATTERNS.some((re) => re.test(text))) {
    findings.push("personal-contact");
  }
  return {
    dataClass: findings.length ? "PERSONAL" : "PUBLIC",
    findings,
  };
}

const REDACTED = "[красacted]";

/**
 * Redacts anything that must never reach an external model. Secrets and
 * financial data are *always* redacted; personal contacts are redacted unless
 * the caller explicitly proved a basis (`allowPersonal`).
 */
export function redactForModel(text: string, allowPersonal = false): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  for (const re of FINANCIAL_PATTERNS) out = out.replace(re, REDACTED);
  if (!allowPersonal) {
    for (const re of PERSONAL_PATTERNS) out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Outbound payload policy. Records *what class* of data was sent, never the
 * sensitive content itself (spec §87: no secrets in logs).
 */
export async function logOutboundPayload(params: {
  traceId: string;
  agentId?: string;
  provider: string;
  taskClass: string;
  dataClass: DataClass;
  findings: string[];
  allowed: boolean;
}): Promise<void> {
  try {
    // The outcome record may already exist (recordObservability runs first on
    // some paths); upsert keeps the privacy verdict and the outcome on one row.
    await prisma.aiModelCall.upsert({
      where: { traceId: params.traceId },
      create: {
        traceId: params.traceId,
        agentName: params.agentId ?? "gateway",
        taskClass: params.taskClass,
        provider: params.provider,
        status: params.allowed ? "success" : "blocked_policy",
        latencyMs: 0,
        dataClass: params.dataClass,
        findings: JSON.stringify(params.findings),
      },
      update: {
        dataClass: params.dataClass,
        findings: JSON.stringify(params.findings),
        status: params.allowed ? "success" : "blocked_policy",
      },
    });
  } catch {
    // Logging must never break the request path.
  }
}
