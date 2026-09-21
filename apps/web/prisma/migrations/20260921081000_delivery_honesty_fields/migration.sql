-- AlterTable
ALTER TABLE "DeliveryShipment" ADD COLUMN "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DeliveryEvent" ADD COLUMN "description" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryEvent_shipmentId_status_occurredAt_key" ON "DeliveryEvent"("shipmentId", "status", "occurredAt");
