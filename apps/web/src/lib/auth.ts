/**
 * Authentication: session token minting/verification + request-scoped helpers.
 *
 * Tokens are HMAC-SHA256 signed with Web Crypto so the *same* code runs in
 * Edge middleware and in Node route handlers. Passwords use bcrypt.
 * Tokens are stored in a `svetlana_session` httpOnly cookie; the cookie is
 * never readable by client JS.
 */
import bcrypt from "bcryptjs";
import { env } from "./env";
import { prisma } from "./prisma";
import {
  getSellerOnboardingGate,
  type OnboardingGate,
} from "./domains/seller-onboarding";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Session, User } from "@prisma/client";

const ALG = "HS256";
const COOKIE_NAME = "svetlana_session";
const SALT_ROUNDS = 10;

function base64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return binary;
}

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(env.jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export interface TokenPayload {
  sub: string;
  role: string;
  exp: number;
  /**
   * Unique token id. Without it two tokens minted for the same user within the
   * same second (e.g. register + login back-to-back) would be byte-identical,
   * which violates the unique constraint on svetlana_session.token.
   */
  jti: string;
}

export async function createToken(payload: Omit<TokenPayload, "exp" | "jti">): Promise<string> {
  const key = await getKey();
  const expiresInSec = parseExpiresIn(env.jwtExpiresIn);
  const body: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSec,
    jti: crypto.randomUUID(),
  };
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: ALG, typ: "JWT" })));
  const payloadB64 = base64url(enc.encode(JSON.stringify(body)));
  const signingInput = `${header}.${payloadB64}`;
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payloadB64, signature] = parts;
  const key = await getKey();
  const enc = new TextEncoder();
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlToBytes(signature),
      enc.encode(`${header}.${payloadB64}`)
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64)) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function base64urlToBytes(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function parseExpiresIn(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return 7 * 24 * 60 * 60;
  const num = Number(match[1]);
  const unit = match[2];
  const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return num * mult;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

/**
 * Extracts the bearer token from either the Authorization header or the
 * session cookie, then resolves the active session + user.
 */
export async function resolveSession(request: Request): Promise<{
  session: Session | null;
  user: User | null;
}> {
  const token = extractToken(request);
  if (!token) return { session: null, user: null };
  const payload = await verifyToken(token);
  if (!payload) return { session: null, user: null };

  const session = await prisma.session.findFirst({
    where: { token, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!session) return { session: null, user: null };
  return { session, user: session.user };
}

function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(cookieHeader);
  return match ? match[1].trim() : null;
}

export function setSessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    `SameSite=Lax`,
    `Max-Age=${parseExpiresIn(env.jwtExpiresIn)}`,
    secure ? "Secure" : "",
  ].filter(Boolean);
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return attrs.join("; ");
}

// ---------------------------------------------------------------------------
// Authorization helpers — every sensitive backend action must call one of these
// ---------------------------------------------------------------------------

export interface AuthContext {
  user: User;
  session: Session;
}

export async function requireUser(request: Request): Promise<AuthContext> {
  const { session, user } = await resolveSession(request);
  if (!session || !user) {
    throw new ApiError(401, "Необходима авторизация");
  }
  if (user.isBlocked) {
    throw new ApiError(403, "Аккаунт заблокирован");
  }
  return { user, session };
}

export async function requireBuyer(request: Request): Promise<AuthContext> {
  const ctx = await requireUser(request);
  return ctx;
}

export async function requireSeller(request: Request): Promise<AuthContext & { sellerId: string }> {
  const ctx = await requireUser(request);
  const seller = await prisma.sellerProfile.findFirst({
    where: { userId: ctx.user.id },
  });
  if (!seller) {
    throw new ApiError(403, "Требуется профиль продавца");
  }
  return { ...ctx, sellerId: seller.id };
}

/**
 * Seller authorization for trading actions (publish, receive orders, payout).
 * Enforces the verification machine instead of merely checking that a profile
 * exists (P0 fix, spec §19/§21): an unverified seller keeps read access to the
 * cabinet but cannot trade.
 */
export async function requireVerifiedSeller(
  request: Request,
  action: string
): Promise<AuthContext & { sellerId: string; onboarding: OnboardingGate }> {
  const ctx = await requireSeller(request);
  const onboarding = await getSellerOnboardingGate(ctx.sellerId);
  if (!onboarding.active) {
    throw new ApiError(
      403,
      `Нельзя ${action}: ${onboarding.blockers.join(", ")}. Следующий шаг — ${onboarding.nextStep ?? "завершите верификацию"}.`,
      "seller_not_verified"
    );
  }
  return { ...ctx, sellerId: ctx.sellerId, onboarding };
}

export async function requireAdmin(request: Request): Promise<AuthContext> {
  const ctx = await requireUser(request);
  if (ctx.user.role !== "ADMIN") {
    throw new ApiError(403, "Требуются права администратора");
  }
  return ctx;
}

/**
 * Structured API error. Route handlers convert this into a JSON response with
 * a user-friendly Russian message — never a stack trace.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code ?? "api_error" },
      { status: error.statusCode }
    );
  }
  // Never leak internal details to the client; log server-side only.
  console.error("[api] unhandled error", error);
  const message =
    error instanceof Error ? error.message : "Внутренняя ошибка сервера";
  return Response.json(
    { error: "Не удалось выполнить запрос. Попробуйте позже.", code: "internal_error", detail: env.isProduction ? undefined : message },
    { status: 500 }
  );
}

// ---------------------------------------------------------------------------
// Server-component helpers
// ---------------------------------------------------------------------------
// App-router server components have no `Request` object, so session cookies
// are read from next/headers instead. The same verification path is used.
export async function serverRequest(): Promise<Request> {
  // Next 15 made headers() asynchronous.
  const headerList = await headers();
  const url = new URL(headerList.get("x-forwarded-path") ?? headerList.get("path") ?? "/", "http://localhost");
  const request = new Request(url, {
    headers: headerList,
  });
  return request;
}

export async function requireUserServer(): Promise<AuthContext> {
  // Inside a React Server Component an thrown ApiError renders as a 500 page.
  // The idiomatic App Router behaviour for an unauthenticated page request is
  // a redirect to login (spec §38: graceful, human-understandable auth flow).
  try {
    return await requireUser(await serverRequest());
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 401) redirect("/login");
    throw e;
  }
}

export async function requireSellerServer(): Promise<AuthContext & { sellerId: string }> {
  try {
    return await requireSeller(await serverRequest());
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 401) redirect("/login");
    throw e;
  }
}

export async function requireAdminServer(): Promise<AuthContext> {
  try {
    return await requireAdmin(await serverRequest());
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 401) redirect("/login");
    throw e;
  }
}
