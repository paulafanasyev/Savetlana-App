-- CreateTable
CREATE TABLE "ProductEmbedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductEmbedding_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductEmbedding_productId_key" ON "ProductEmbedding"("productId");
