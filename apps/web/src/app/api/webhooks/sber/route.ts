import { apiRoute } from "@/lib/api-helpers";
import { RbsPaymentProvider, mapRbsStatus } from "@/lib/domains/rbs";
import { applyVerifiedPayment } from "@/lib/domains/payment-webhooks";

export const dynamic = "force-dynamic";

/**
 * Callback Сбербанка (платформа RBS). Банк присылает mdOrder и статус операции;
 * мы проверяем checksum (если задан SBER_CALLBACK_SECRET) и перезапрашиваем
 * заказ через getOrderStatusExtended — решение только по ответу API банка.
 */
async function handle(request: Request): Promise<Response> {
  const provider = new RbsPaymentProvider("sber");
  if (!provider.available) return new Response("not configured", { status: 503 });

  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));
  if (request.method === "POST") {
    const text = await request.text().catch(() => "");
    new URLSearchParams(text).forEach((v, k) => (params[k] = v));
  }
  if (!provider.verifyCallback(params)) return new Response("bad checksum", { status: 401 });

  const mdOrder = params.mdOrder ?? "";
  if (!/^[\w-]{8,64}$/.test(mdOrder)) return new Response("bad order", { status: 400 });

  const live = await provider.getPayment(mdOrder);
  await applyVerifiedPayment({
    providerKey: provider.key,
    providerRef: mdOrder,
    orderId: live.orderId,
    status: mapRbsStatus(live.orderStatus),
    rawStatus: `status_${live.orderStatus ?? "unknown"}`,
    amountKopecks: live.amountKopecks,
  });
  return new Response("OK", { status: 200 });
}

export const GET = apiRoute(async (request) => handle(request));
export const POST = apiRoute(async (request) => handle(request));
