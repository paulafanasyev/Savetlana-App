import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { unlinkVkAccount, suggestVkRelationships, isVkLive } from "@/lib/domains/vk";

export const dynamic = "force-dynamic";

/** Revokes the VK link and clears the stored token reference (spec §19). */
export const DELETE = apiRoute(async (request) => {
  const user = await requireBuyer(request);
  await unlinkVkAccount({ userId: user.user.id, actorId: user.user.id });
  return Response.json({ ok: true });
});

/**
 * Produces relationship *suggestions* from granted VK friends. Every
 * suggestion is SUGGESTED status with confidence < 1 — never an asserted fact
 * (spec §16, §18). Requires the friends scope and a live VK link.
 */
export const POST = apiRoute(async (request) => {
  const user = await requireBuyer(request);
  if (!isVkLive()) {
    return Response.json(
      {
        ok: false,
        error: "PENDING_EXTERNAL_ACCESS",
        note: "VK-интеграция не настроена",
      },
      { status: 503 },
    );
  }
  const result = await suggestVkRelationships({ userId: user.user.id });
  return Response.json({
    ok: true,
    created: result.created,
    note:
      result.created === 0
        ? "Нет новых предложений среди ваших друзей из VK"
        : `Создано ${result.created} предложений. Каждое требует подтверждения второго человека.`,
  });
});
