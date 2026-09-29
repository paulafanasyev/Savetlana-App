-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Classified" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vertical" TEXT NOT NULL,
    "dealType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sellerId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "attrs" TEXT NOT NULL DEFAULT '{}',
    "priceKopecks" INTEGER NOT NULL DEFAULT 0,
    "oldPriceKopecks" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "regionId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "districtName" TEXT,
    "addressLine" TEXT,
    "metroId" TEXT,
    "metroWalkMin" INTEGER,
    "lat" REAL,
    "lon" REAL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "moderationNote" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "contactsShown" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "aiDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Classified_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Classified_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Classified_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Classified_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Classified_metroId_fkey" FOREIGN KEY ("metroId") REFERENCES "MetroStation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Classified" ("addressLine", "aiDraft", "attrs", "authorId", "category", "cityId", "contactsShown", "createdAt", "currency", "dealType", "description", "districtName", "expiresAt", "id", "lat", "lon", "metroId", "metroWalkMin", "moderationNote", "oldPriceKopecks", "priceKopecks", "regionId", "sellerId", "status", "title", "updatedAt", "vertical", "views") SELECT "addressLine", "aiDraft", "attrs", "authorId", "category", "cityId", "contactsShown", "createdAt", "currency", "dealType", "description", "districtName", "expiresAt", "id", "lat", "lon", "metroId", "metroWalkMin", "moderationNote", "oldPriceKopecks", "priceKopecks", "regionId", "sellerId", "status", "title", "updatedAt", "vertical", "views" FROM "Classified";
DROP TABLE "Classified";
ALTER TABLE "new_Classified" RENAME TO "Classified";
CREATE INDEX "Classified_vertical_dealType_status_idx" ON "Classified"("vertical", "dealType", "status");
CREATE INDEX "Classified_regionId_cityId_idx" ON "Classified"("regionId", "cityId");
CREATE INDEX "Classified_status_createdAt_idx" ON "Classified"("status", "createdAt");
CREATE INDEX "Classified_authorId_idx" ON "Classified"("authorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

