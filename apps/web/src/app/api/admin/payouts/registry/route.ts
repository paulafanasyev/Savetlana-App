import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/domains/audit";
import { encodeCp1251, registry1C, registryCsv, registryPayerFromEnv, registryRows } from "@/lib/domains/payout-registry";

export const dynamic = "force-dynamic";

/**
 * Реестр выплат, ждущих перевода: ?format=csv (просмотр в Excel) или
 * ?format=1c (файл для загрузки платёжек в интернет-банк). Содержит полные
 * реквизиты, поэтому только для администратора и с записью в аудит.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:payout-registry", 20, 60_000)) return tooManyRequests();
  const { user } = await requireAdmin(request);
  const format = new URL(request.url).searchParams.get("format") === "1c" ? "1c" : "csv";
  const rows = await registryRows();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await audit({ actorId: user.id, actorRole: "admin", action: "payout.registry_exported", targetType: "Payout", after: { format, count: rows.length } });

  if (format === "1c") {
    const payer = registryPayerFromEnv();
    if (!payer) {
      return Response.json(
        { error: "Не заданы реквизиты счёта площадки: PAYOUT_PAYER_NAME, PAYOUT_PAYER_INN, PAYOUT_PAYER_ACCOUNT, PAYOUT_PAYER_BANK, PAYOUT_PAYER_BIK, PAYOUT_PAYER_CORR", code: "payer_required" },
        { status: 409 },
      );
    }
    const body = encodeCp1251(registry1C(rows, payer));
    return new Response(body as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/plain; charset=windows-1251",
        "Content-Disposition": `attachment; filename="payouts-${stamp}-1c.txt"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(`\uFEFF${registryCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payouts-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
