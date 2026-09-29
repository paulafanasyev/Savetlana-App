/**
 * Shared helpers. Money is always stored as integer kopecks — floats never
 * touch commerce math (spec §124 CONSISTENCY).
 */

export const KOPECKS_PER_UNIT = 100;

/** SHA-256 of raw bytes, hex-encoded. Used for file integrity (spec §81). */
export function sha256Hex(bytes: Buffer): string {
  return require("node:crypto").createHash("sha256").update(bytes).digest("hex");
}

export function toKopecks(amount: number): number {
  return Math.round(amount * KOPECKS_PER_UNIT);
}

export function fromKopecks(kopecks: number): number {
  return kopecks / KOPECKS_PER_UNIT;
}

export function formatMoney(kopecks: number, currency = "RUB"): string {
  const value = fromKopecks(kopecks);
  const formatted = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return formatted;
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function slugify(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
    я: "ya",
  };
  return input
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function generateOrderNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SV-${stamp}-${rand}`;
}

export function generateToken(bytes = 32): string {
  // crypto.randomUUID is available in Node 18+ / Edge
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
}

export function maskString(value: string, visible = 4): string {
  if (value.length <= visible * 2) return "*".repeat(value.length);
  return value.slice(0, visible) + "*".repeat(value.length - visible * 2) + value.slice(-visible);
}

export function hashIp(ip: string, salt: string): string {
  // IP addresses are only ever stored as one-way hashes, never in plaintext.
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Verdict classification used everywhere in the platform. A function is only
 * VERIFIED when we have runtime evidence it works against a real backend.
 */
export type VerificationVerdict =
  | "VERIFIED"
  | "MOCK_VERIFIED"
  | "NOT_PROVEN"
  | "PENDING_EXTERNAL_ACCESS"
  | "BLOCKED";
