import { apiRoute } from "@/lib/api-helpers";
import { setSessionCookie } from "@/lib/auth";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/domains/rate-limits";
import { juryGuestEnabled } from "@/lib/domains/jury-guest";
import { createJurySeller } from "@/lib/domains/jury-seller";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => Response.json({ enabled: juryGuestEnabled() }));

/** Создать временный демо-магазин с входящим КП и сразу войти в него. */
export const POST = apiRoute(async (request) => {
  const { user, token, quote } = await createJurySeller(clientIp(request));
  const response = Response.json({ user, quote: quote ? quote.number : null, next: "/seller/quotes" });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
});
