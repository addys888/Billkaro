-- AlterTable
ALTER TABLE "users" ADD COLUMN     "subscription_expires_at" TIMESTAMP(3),
ADD COLUMN     "subscription_plan" TEXT NOT NULL DEFAULT 'Trial',
ADD COLUMN     "subscription_status" TEXT NOT NULL DEFAULT 'active';
