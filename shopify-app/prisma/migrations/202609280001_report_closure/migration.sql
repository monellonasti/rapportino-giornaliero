-- CreateTable
CREATE TABLE "ReportClosure" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "operatorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportClosure_shop_reportDate_key" ON "ReportClosure"("shop", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReportClosure_shop_requestId_key" ON "ReportClosure"("shop", "requestId");

-- Il rapportino definitivo non si modifica e non si cancella: resta aggiornabile solo l'esito dell'email.
CREATE FUNCTION "report_closure_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Rapportino definitivo non modificabile';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."shop" IS DISTINCT FROM OLD."shop"
        OR NEW."reportDate" IS DISTINCT FROM OLD."reportDate"
        OR NEW."report" IS DISTINCT FROM OLD."report"
        OR NEW."operatorId" IS DISTINCT FROM OLD."operatorId"
        OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'Rapportino definitivo non modificabile';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "ReportClosure_immutable"
BEFORE UPDATE OR DELETE ON "ReportClosure"
FOR EACH ROW EXECUTE FUNCTION "report_closure_immutable"();
