/**
 * Push subscription registration (RFC 8030).
 *
 * The browser hands the platform its PushSubscription; we store it so that
 * `deliverNotification` can reach the user out of band. A user may list and
 * revoke their subscriptions at any time from the Privacy Center.
 */
import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/domains/audit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const body = await jsonBody<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>(
    request
  );

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const authKey = body.keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    return Response.json({ error: "subscription_incomplete" }, { status: 400 });
  }
  if (!endpoint.startsWith("https://")) {
    return Response.json({ error: "endpoint_must_be_https" }, { status: 400 });
  }

  const sub = await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId: user.id, endpoint } },
    create: {
      userId: user.id,
      endpoint,
      p256dhKey: p256dh,
      authKey,
      userAgent: request.headers.get("user-agent")?.slice(0, 300),
    },
    update: {
      // Re-subscribe revives a previously revoked subscription.
      p256dhKey: p256dh,
      authKey,
      revokedAt: null,
      userAgent: request.headers.get("user-agent")?.slice(0, 300),
    },
  });

  await audit({
    actorId: user.id,
    actorRole: "user",
    action: "push.subscribe",
    targetType: "push_subscription",
    targetId: sub.id,
    after: { endpoint: endpoint.slice(0, 80) },
  });

  return Response.json({ ok: true, id: sub.id });
});

export const DELETE = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint");

  if (endpoint) {
    await prisma.pushSubscription.updateMany({
      where: { userId: user.id, endpoint },
      data: { revokedAt: new Date() },
    });
  } else {
    // Revoke every subscription for this user.
    await prisma.pushSubscription.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await audit({
    actorId: user.id,
    actorRole: "user",
    action: "push.revoke",
    targetType: "push_subscription",
    after: { endpoint: endpoint?.slice(0, 80) ?? "all" },
  });

  return Response.json({ ok: true });
});
