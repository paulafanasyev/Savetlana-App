/**
 * Delivery history — what the platform actually sent to the user, on which
 * channel, and with what result. Powers the Privacy Center (spec §82).
 */
import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { deliveryHistory, deliveryStatusLabel } from "@/lib/notification-delivery";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);

  const deliveries = await deliveryHistory(user.id, limit);

  return Response.json({
    items: deliveries.map((d) => ({
      ...d,
      statusLabel: deliveryStatusLabel(d.status),
    })),
  });
});
