import { buildYml, loadYmlInput } from "@/lib/yml-feed";

export const dynamic = "force-dynamic";

/**
 * Выгрузка для Яндекса: /feed/yandex.yml (вся площадка) или
 * /feed/yandex.yml?seller=<id> (один продавец). Яндекс забирает файл сам
 * по расписанию; ответ кэшируется на час, чтобы не грузить базу.
 */
export async function GET(request: Request): Promise<Response> {
  const sellerParam = new URL(request.url).searchParams.get("seller");
  const sellerId = sellerParam && /^[a-z0-9]{8,40}$/i.test(sellerParam) ? sellerParam : undefined;
  if (sellerParam && !sellerId) return new Response("Неверный продавец", { status: 400 });
  try {
    const { xml } = buildYml(await loadYmlInput(sellerId));
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=600",
      },
    });
  } catch {
    return new Response("Выгрузка временно недоступна", { status: 503, headers: { "Retry-After": "300" } });
  }
}
