import { masterAgent } from "../src/lib/ai/agents/master";
import { prisma } from "../src/lib/prisma";

async function main() {
  const buyer = await prisma.user.findFirst({ where: { role: "BUYER" } });
  if (!buyer) throw new Error("no buyer in db");
  console.log("buyer:", buyer.email);

  const r1 = await masterAgent.run({
    userId: buyer.id,
    message: "Найди ноутбук до 100 тысяч для работы",
    role: "buyer",
  });
  console.log("--- BUYER SEARCH ---");
  console.log("answer:", r1.answer);
  console.log("agent:", r1.agent, "verification:", r1.verification, "steps:", r1.steps.map((s) => s.toolName));

  const r2 = await masterAgent.run({
    userId: buyer.id,
    message: "Что подарить маме до 10000 рублей?",
    role: "buyer",
  });
  console.log("--- GIFT ---");
  console.log("answer:", r2.answer);
  console.log("agent:", r2.agent, "steps:", r2.steps.map((s) => s.toolName));

  const seller = await prisma.sellerProfile.findFirst({ include: { user: true } });
  if (seller) {
    const r3 = await masterAgent.run({
      userId: seller.user.id,
      message: "Почему упали продажи?",
      role: "seller",
      sellerProfileId: seller.id,
    });
    console.log("--- SELLER ANALYTICS ---");
    console.log("answer:", r3.answer.slice(0, 400));
    console.log("agent:", r3.agent, "steps:", r3.steps.map((s) => s.toolName));

    const product = await prisma.product.findFirst({ where: { sellerId: seller.id, status: "ACTIVE" } });
    if (product) {
      const r4 = await masterAgent.run({
        userId: seller.user.id,
        message: `Подтверди наличие товара ${product.title}`,
        role: "seller",
        sellerProfileId: seller.id,
      });
      console.log("--- CONFIRM INVENTORY (no confirmation) ---");
      console.log("answer:", r4.answer);
      console.log("pending:", r4.pendingConfirmation?.toolName);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
