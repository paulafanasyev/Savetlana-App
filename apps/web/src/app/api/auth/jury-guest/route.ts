import { apiRoute } from "@/lib/api-helpers";
import { setSessionCookie } from "@/lib/auth";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/domains/rate-limits";
import { createJuryGuest, juryGuestEnabled } from "@/lib/domains/jury-guest";

export const dynamic = "force-dynamic";

/** Включён ли вход для жюри (страница входа показывает кнопку только тогда). */
export const GET = apiRoute(async () => Response.json({ enabled: juryGuestEnabled() }));

/** Создать временный аккаунт покупателя и сразу войти в него. */
export const POST = apiRoute(async (request) => {
  const { user, token } = await createJuryGuest(clientIp(request));
  const response = Response.json({ user, needsConsent: false });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
});
