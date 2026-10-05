/**
 * Creates (or promotes) the first administrator on a fresh production DB.
 * Production never runs the demo seed (it has a public demo password).
 *   docker compose run --rm migrate npx tsx scripts/create-admin.ts admin@example.ru "Имя"
 * Password: ADMIN_PASSWORD env or generated and printed once.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Использование: npx tsx scripts/create-admin.ts admin@example.ru "Имя"');
    process.exit(2);
  }
  const name = nameParts.join(" ").trim() || "Администратор";
  const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString("base64url");
  if (password.length < 12) {
    console.error("ADMIN_PASSWORD должен быть не короче 12 символов");
    process.exit(2);
  }
  const normalized = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN", passwordHash: await hashPassword(password) } });
    console.log(`Пользователь ${normalized} назначен администратором.`);
  } else {
    const user = await prisma.user.create({ data: { email: normalized, name, role: "ADMIN", passwordHash: await hashPassword(password) } });
    await prisma.profile.create({ data: { userId: user.id, displayName: name } });
    console.log(`Администратор ${normalized} создан.`);
  }
  if (!process.env.ADMIN_PASSWORD) console.log(`Пароль (сохраните): ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
