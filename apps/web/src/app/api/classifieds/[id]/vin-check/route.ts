import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { runVinCheck } from "@/lib/domains/vin-checks";

export const dynamic = "force-dynamic";

// Run (or refresh) a VIN check for an auto classified. The report is a fact
// about a vehicle: until an official source is configured the result is
// surfaced as NOT_PROVEN, never a fabricated "clean" history.
export const POST = apiRoute(async (request, { params }) => {
  const ctx = await requireUser(request);
  const classifiedId = params.id;

  // The ad page posts a plain HTML form; the API contract also accepts JSON.
  const contentType = request.headers.get("content-type") ?? "";
  const vin: string | undefined = contentType.includes("application/json")
    ? ((await request.json().catch(() => ({}))) as { vin?: string }).vin
    : (await request.formData()).get("vin")?.toString();

  if (!vin || vin.trim().length < 10) {
    return Response.json({ error: "invalid_vin_format" }, { status: 400 });
  }

  const report = await runVinCheck(params.id, vin, ctx.user.id, {
    actorRole: ctx.user.role,
  });

  return Response.json({
    verification: report.verification,
    status: report.status,
    source: report.source,
    report,
  });
});
