import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setShipCity } from "@/lib/domains/seller-ship-from";

export const dynamic = "force-dynamic";

/** Продавец указывает город отгрузки (обычная форма в кабинете). Пустое поле убирает город. */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const back = (status: string) => Response.redirect(new URL(`/seller?ship=${status}`, request.url), 303);
  if (!rateLimit(`seller-ship-city:${user.id}`, 20, 60 * 60_000)) return tooManyRequests();
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!seller) return back("noseller");
  const form = await request.formData();
  const raw = String(form.get("city") ?? "").trim();
  try {
    const saved = await setShipCity(user.id, raw || null);
    return back(saved ? "saved" : "cleared");
  } catch (e) {
    if (e instanceof Error && e.message === "unknown_city") return back("bad");
    throw e;
  }
});
