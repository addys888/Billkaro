/*
  Warnings:

  - A unique constraint covering the columns `[user_id,invoice_no]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "invoices_invoice_no_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_user_id_invoice_no_key" ON "invoices"("user_id", "invoice_no");
