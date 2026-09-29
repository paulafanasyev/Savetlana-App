-- CreateTable
CREATE TABLE "FederalDistrict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Region_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "FederalDistrict" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "hasMetro" BOOLEAN NOT NULL DEFAULT false,
    "population" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "City_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetroLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetroLine_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetroStation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetroStation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MetroLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Classified" (
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
    CONSTRAINT "Classified_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Classified_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Classified_metroId_fkey" FOREIGN KEY ("metroId") REFERENCES "MetroStation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassifiedImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classifiedId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassifiedImage_classifiedId_fkey" FOREIGN KEY ("classifiedId") REFERENCES "Classified" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VinCheck" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VinCheck_classifiedId_fkey" FOREIGN KEY ("classifiedId") REFERENCES "Classified" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OAuthState" ("createdAt", "expiresAt", "handle", "id", "provider", "redirectUri", "signature", "usedAt", "userId") SELECT "createdAt", "expiresAt", "handle", "id", "provider", "redirectUri", "signature", "usedAt", "userId" FROM "OAuthState";
DROP TABLE "OAuthState";
ALTER TABLE "new_OAuthState" RENAME TO "OAuthState";
CREATE UNIQUE INDEX "OAuthState_handle_key" ON "OAuthState"("handle");
CREATE INDEX "OAuthState_userId_idx" ON "OAuthState"("userId");
CREATE INDEX "OAuthState_provider_idx" ON "OAuthState"("provider");
CREATE TABLE "new_OutboxMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregate" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_OutboxMessage" ("aggregate", "aggregateId", "attempts", "createdAt", "id", "lastError", "maxAttempts", "nextAttemptAt", "payload", "processedAt", "status", "type") SELECT "aggregate", "aggregateId", "attempts", "createdAt", "id", "lastError", "maxAttempts", "nextAttemptAt", "payload", "processedAt", "status", "type" FROM "OutboxMessage";
DROP TABLE "OutboxMessage";
ALTER TABLE "new_OutboxMessage" RENAME TO "OutboxMessage";
CREATE INDEX "OutboxMessage_status_nextAttemptAt_idx" ON "OutboxMessage"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "OutboxMessage_aggregate_aggregateId_type_key" ON "OutboxMessage"("aggregate", "aggregateId", "type");
CREATE TABLE "new_PendingAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "toolName" TEXT NOT NULL,
    "argsHash" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "riskLevel" TEXT NOT NULL DEFAULT 'READ',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    CONSTRAINT "PendingAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PendingAction" ("args", "argsHash", "consumedAt", "conversationId", "createdAt", "expiresAt", "id", "nonce", "riskLevel", "status", "toolName", "userId") SELECT "args", "argsHash", "consumedAt", "conversationId", "createdAt", "expiresAt", "id", "nonce", "riskLevel", "status", "toolName", "userId" FROM "PendingAction";
DROP TABLE "PendingAction";
ALTER TABLE "new_PendingAction" RENAME TO "PendingAction";
CREATE UNIQUE INDEX "PendingAction_nonce_key" ON "PendingAction"("nonce");
CREATE INDEX "PendingAction_userId_idx" ON "PendingAction"("userId");
CREATE INDEX "PendingAction_conversationId_idx" ON "PendingAction"("conversationId");
CREATE INDEX "PendingAction_status_idx" ON "PendingAction"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FederalDistrict_name_key" ON "FederalDistrict"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE INDEX "Region_districtId_idx" ON "Region"("districtId");

-- CreateIndex
CREATE INDEX "City_regionId_idx" ON "City"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "City_name_regionId_key" ON "City"("name", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "MetroLine_name_cityId_key" ON "MetroLine"("name", "cityId");

-- CreateIndex
CREATE INDEX "MetroStation_lineId_idx" ON "MetroStation"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "MetroStation_name_lineId_key" ON "MetroStation"("name", "lineId");

-- CreateIndex
CREATE INDEX "Classified_vertical_dealType_status_idx" ON "Classified"("vertical", "dealType", "status");

-- CreateIndex
CREATE INDEX "Classified_regionId_cityId_idx" ON "Classified"("regionId", "cityId");

-- CreateIndex
CREATE INDEX "Classified_status_createdAt_idx" ON "Classified"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Classified_authorId_idx" ON "Classified"("authorId");

-- CreateIndex
CREATE INDEX "ClassifiedImage_classifiedId_idx" ON "ClassifiedImage"("classifiedId");

-- CreateIndex
CREATE UNIQUE INDEX "VinCheck_vin_key" ON "VinCheck"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "VinCheck_vinHash_key" ON "VinCheck"("vinHash");

-- CreateIndex
CREATE INDEX "VinCheck_classifiedId_idx" ON "VinCheck"("classifiedId");

-- CreateIndex
CREATE INDEX "VinCheck_vinHash_idx" ON "VinCheck"("vinHash");

