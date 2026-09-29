-- AlterTable
-- Storage key for private object reads (P0-11: media/document storage layer).
-- fileUrl alone may be a public URL and must not be the only reference.
ALTER TABLE "SellerDocument" ADD COLUMN "storageKey" TEXT;
