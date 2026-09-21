import { apiRoute } from "@/lib/api-helpers";
import { resolveSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await resolveSession(request);
  if (!user) return Response.json({ user: null });
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, displayName: true, slug: true },
  });
  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    sellerProfile,
  });
});
