export const dynamic = "force-dynamic";

import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { forgetMemoryEntry } from "@/lib/domains/memory";

export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  await forgetMemoryEntry(user.id, params.id);
  return Response.json({ ok: true });
});
