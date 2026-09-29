-- Dispute Case System (audit §32): messages, evidence, SLA, assignment, appeals
CREATE TABLE IF NOT EXISTS "DisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DisputeMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DisputeEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "DisputeHistory" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "DisputeHistory_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "Dispute" ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "assignedAdminId" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "sellerSlaUntil" DATETIME;
ALTER TABLE "Dispute" ADD COLUMN "slaBreached" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dispute" ADD COLUMN "appealedAt" DATETIME;
ALTER TABLE "Dispute" ADD COLUMN "appealReason" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "refundId" TEXT;
ALTER TABLE "Refund" ADD COLUMN "payoutBlocked" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "DisputeMessage_disputeId_createdAt_idx" ON "DisputeMessage"("disputeId", "createdAt");
CREATE INDEX IF NOT EXISTS "DisputeEvidence_disputeId_idx" ON "DisputeEvidence"("disputeId");
CREATE INDEX IF NOT EXISTS "DisputeHistory_disputeId_createdAt_idx" ON "DisputeHistory"("disputeId", "createdAt");
CREATE INDEX IF NOT EXISTS "Dispute_assignedAdminId_idx" ON "Dispute"("assignedAdminId");
CREATE UNIQUE INDEX IF NOT EXISTS "Dispute_refundId_key" ON "Dispute"("refundId");
