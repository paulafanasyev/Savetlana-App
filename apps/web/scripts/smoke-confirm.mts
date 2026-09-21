import { masterAgent } from "../src/lib/ai/agents/master";
import { prisma } from "../src/lib/prisma";

async function main() {
  const seller = await prisma.sellerProfile.findFirst({ include: { user: true } });
  if (!seller) throw new Error("no seller");
  const product = await prisma.product.findFirst({ where: { sellerId: seller.id, status: "ACTIVE" } });
  if (!product) throw new Error("no active product");

  // reset to a known state
  await prisma.inventory.deleteMany({ where: { productId: product.id } });

  const first = await masterAgent.run({
    userId: seller.user.id,
    message: `Подтверди наличие товара ${product.title}`,
    role: "seller",
    sellerProfileId: seller.id,
  });
  console.log("first:", first.answer);
  console.log("pending:", first.pendingConfirmation?.toolName);

  if (first.pendingConfirmation) {
    const second = await masterAgent.executeConfirmed(
      { userId: seller.user.id, role: "seller", sellerProfileId: seller.id,
        conversationId: first.conversationId },
      first.pendingConfirmation
    );
    console.log("confirmed:", second.answer);
    console.log("steps:", second.steps.map((s) => `${s.toolName}:ok=${s.result.ok}`));
    const inv = await prisma.inventory.findUnique({ where: { productId: product.id } });
    console.log("db: confirmed=", inv?.confirmedBySeller, "qty=", inv?.quantity, "avail=", inv?.availability);
    const hist = await prisma.listingHistory.count({ where: { productId: product.id, action: "AVAILABILITY_CONFIRMED" } });
    console.log("listing history entries:", hist);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
