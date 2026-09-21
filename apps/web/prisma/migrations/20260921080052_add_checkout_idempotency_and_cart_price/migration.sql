/*
  Warnings:

  - Added the required column `idempotencyKey` to the `OrderGroup` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CartItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceKopecks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CartItem" ("cartId", "createdAt", "id", "productId", "quantity", "updatedAt", "variantId") SELECT "cartId", "createdAt", "id", "productId", "quantity", "updatedAt", "variantId" FROM "CartItem";
DROP TABLE "CartItem";
ALTER TABLE "new_CartItem" RENAME TO "CartItem";
CREATE UNIQUE INDEX "CartItem_cartId_productId_variantId_key" ON "CartItem"("cartId", "productId", "variantId");
CREATE TABLE "new_OrderGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalKopecks" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderGroup_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrderGroup" ("buyerId", "createdAt", "currency", "id", "totalKopecks") SELECT "buyerId", "createdAt", "currency", "id", "totalKopecks" FROM "OrderGroup";
DROP TABLE "OrderGroup";
ALTER TABLE "new_OrderGroup" RENAME TO "OrderGroup";
CREATE UNIQUE INDEX "OrderGroup_idempotencyKey_key" ON "OrderGroup"("idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
