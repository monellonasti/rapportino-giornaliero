-- Annullamento delle uscite prima della chiusura: l'uscita resta registrata con chi e quando.
ALTER TABLE "CashExpense" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledBy" TEXT;
