import { z } from "zod";
import { cents, dateRange, shortDate } from "./report";
import db from "./db.server";
import { isClosed, lockDay } from "./closures.server";
import { UserError } from "./errors";
const schema = z.object({
  date: z.string(),
  amount: z.string().regex(/^\d{1,7}([.,]\d{1,2})?$/),
  reason: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500),
  requestId: z.string().uuid(),
});
export async function addExpense(
  shop: string,
  operatorId: string,
  form: FormData,
) {
  const value = schema.parse(Object.fromEntries(form));
  dateRange(value.date, "UTC");
  const amountCents = cents(value.amount.replace(",", "."));
  if (amountCents <= 0 || amountCents > 100000000)
    throw new Error("Importo consentito: da 0,01 a 1.000.000 EUR");
  return db.$transaction(async (tx) => {
    // Stesso lock della stampa definitiva: nessuna uscita entra a chiusura in corso.
    await lockDay(tx, shop, value.date);
    if (await isClosed(shop, value.date, tx))
      throw new UserError(
        `Il rapportino del ${shortDate(value.date)} è definitivo: non si possono aggiungere uscite.`,
      );
    return tx.cashExpense.upsert({
      where: { shop_requestId: { shop, requestId: value.requestId } },
      update: {},
      create: {
        shop,
        operatorId,
        requestId: value.requestId,
        reportDate: value.date,
        amountCents,
        reason: value.reason,
        note: value.note,
      },
    });
  });
}
