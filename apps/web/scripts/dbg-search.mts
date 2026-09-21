import { searchProducts } from "../src/lib/domains/catalog";
import { prisma } from "../src/lib/prisma";
async function main() {
  const all = await prisma.product.findMany({ select: { title: true, priceKopecks: true, status: true, keywords: true }, take: 20 });
  console.log("sample products:", JSON.stringify(all.slice(0,6), null, 1));
  for (const q of ["ноутбук", "laptop", "ноутбук для работы"]) {
    const r = await searchProducts({ query: q, maxPrice: 100000, limit: 5 });
    console.log(`q="${q}" -> ${r.results.length} (mode ${r.mode})`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
