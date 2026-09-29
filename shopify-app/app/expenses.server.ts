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
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    throw new UserError(
      "Controlla l'uscita: importo in euro con al massimo due decimali (es. 35,50), causale obbligatoria fino a 100 caratteri, note fino a 500.",
      422,
    );
  const value = parsed.data;
  dateRange(value.date, "UTC");
  const amountCents = cents(value.amount.replace(",", "."));
  if (amountCents <= 0 || amountCents > 100000000)
    throw new UserError("Importo consentito: da 0,01 a 1.000.000 EUR", 422);
  const expense = {
    reportDate: value.date,
    amountCents,
    reason: value.reason,
    note: value.note,
  };
  // La stessa richiesta (es. ripetuta dopo un errore di rete) deve avere gli stessi dati:
  // altrimenti si registrerebbe in silenzio l'importo vecchio al posto di quello corretto.
  const same = (row: typeof expense) =>
    row.reportDate === expense.reportDate &&
    row.amountCents === expense.amountCents &&
    row.reason === expense.reason &&
    row.note === expense.note;
  const conflict = new UserError(
    "Questa uscita risulta già registrata con dati diversi: ricarica la pagina e controlla l'elenco prima di inserirla di nuovo.",
  );
  const key = { shop_requestId: { shop, requestId: value.requestId } };
  return db.$transaction(async (tx) => {
    // Stesso lock della stampa definitiva: nessuna uscita entra a chiusura in corso.
    await lockDay(tx, shop, value.date);
    const existing = await tx.cashExpense.findUnique({ where: key });
    if (existing) {
      if (!same(existing)) throw conflict;
      return existing;
    }
    if (await isClosed(shop, value.date, tx))
      throw new UserError(
        `Il rapportino del ${shortDate(value.date)} è definitivo: non si possono aggiungere uscite.`,
      );
    const saved = await tx.cashExpense.upsert({
      where: key,
      update: {},
      create: { shop, operatorId, requestId: value.requestId, ...expense },
    });
    if (!same(saved)) throw conflict;
    return saved;
  });
}
