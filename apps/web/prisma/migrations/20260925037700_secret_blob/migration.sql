-- Redacted encrypted OAuth tokens (P0 fix, spec §38).
ALTER TABLE "IntegrationLink" ADD COLUMN "secretBlob" TEXT;
