-- Pickup-in-store orders: flag + READY_FOR_PICKUP workflow status
ALTER TYPE "InternalStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';

ALTER TABLE "orders" ADD COLUMN "is_pickup" BOOLEAN NOT NULL DEFAULT false;
