-- CreateTable
CREATE TABLE "AiModelCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "agentName" TEXT,
    "taskClass" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "dataClass" TEXT,
    "findings" TEXT NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModelCall_traceId_key" ON "AiModelCall"("traceId");

-- CreateIndex
CREATE INDEX "AiModelCall_taskClass_idx" ON "AiModelCall"("taskClass");

-- CreateIndex
CREATE INDEX "AiModelCall_provider_idx" ON "AiModelCall"("provider");

-- CreateIndex
CREATE INDEX "AiModelCall_status_idx" ON "AiModelCall"("status");
