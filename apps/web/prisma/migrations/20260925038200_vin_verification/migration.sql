-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VinCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classifiedId" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "vinHash" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "findings" TEXT NOT NULL DEFAULT '[]',
    "restrictions" TEXT NOT NULL DEFAULT '[]',
    "mileageKm" INTEGER,
    "ownersCount" INTEGER,
    "isWanted" BOOLEAN NOT NULL DEFAULT false,
    "hasRestrictions" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" DATETIME,
    "expiresAt" DATETIME,
    "verification" TEXT NOT NULL DEFAULT 'NOT_PROVEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VinCheck_classifiedId_fkey" FOREIGN KEY ("classifiedId") REFERENCES "Classified" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VinCheck" ("checkedAt", "classifiedId", "createdAt", "expiresAt", "findings", "hasRestrictions", "id", "isWanted", "make", "mileageKm", "model", "ownersCount", "restrictions", "source", "status", "vin", "vinHash", "year") SELECT "checkedAt", "classifiedId", "createdAt", "expiresAt", "findings", "hasRestrictions", "id", "isWanted", "make", "mileageKm", "model", "ownersCount", "restrictions", "source", "status", "vin", "vinHash", "year" FROM "VinCheck";
DROP TABLE "VinCheck";
ALTER TABLE "new_VinCheck" RENAME TO "VinCheck";
CREATE UNIQUE INDEX "VinCheck_vin_key" ON "VinCheck"("vin");
CREATE UNIQUE INDEX "VinCheck_vinHash_key" ON "VinCheck"("vinHash");
CREATE INDEX "VinCheck_classifiedId_idx" ON "VinCheck"("classifiedId");
CREATE INDEX "VinCheck_vinHash_idx" ON "VinCheck"("vinHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

