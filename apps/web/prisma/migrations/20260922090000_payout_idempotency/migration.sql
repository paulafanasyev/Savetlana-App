-- AlterTable
-- Client-side idempotency key. Stored before the partner call so a retried
-- request can never create a second disbursement (spec §125). Kept separate
-- from providerRef, which holds the partner's own operation id once it responds.
ALTER TABLE "Payout" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");
