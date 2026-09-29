-- CreateTable
CREATE TABLE IF NOT EXISTS "AuthAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bucket" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuthAttempt_bucket_idx" ON "AuthAttempt"("bucket");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuthAttempt_createdAt_idx" ON "AuthAttempt"("createdAt");
