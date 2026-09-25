-- CreateTable
CREATE TABLE "PendingAction" (
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
    CONSTRAINT "PendingAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingAction_nonce_key" ON "PendingAction"("nonce");

-- CreateIndex
CREATE INDEX "PendingAction_userId_idx" ON "PendingAction"("userId");

-- CreateIndex
CREATE INDEX "PendingAction_conversationId_idx" ON "PendingAction"("conversationId");

-- CreateIndex
CREATE INDEX "PendingAction_status_idx" ON "PendingAction"("status");
