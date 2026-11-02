import { beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
const db = vi.hoisted(() => {
  const client = {
    $executeRaw: vi.fn(),
    cashExpense: { findFirst: vi.fn(), update: vi.fn() },
    reportClosure: { findUnique: vi.fn() },
  };
  return {
    ...client,
    $transaction: vi.fn((fn: (tx: typeof client) => unknown) => fn(client)),
  };
});
vi.mock("../app/db.server", () => ({ default: db }));
import { cancelExpense } from "../app/expenses.server";
import { UserError } from "../app/errors";
import { excel, pdf } from "../app/export.server";
import { makeReport, type Expense } from "../app/report";

const shop = "verified.myshopify.com";
const day = "2026-09-27";
const row = (values: Partial<Record<string, unknown>> = {}) => ({
  id: "e1",
  shop,
  reportDate: day,
  amountCents: 750,
  reason: "Corriere",
  note: "Ritiro pacchi",
  operatorId: "7",
  requestId: "r1",
  createdAt: new Date("2026-09-27T09:30:00Z"),
  cancelledAt: null,
  cancelledBy: null,
  ...values,
});
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("doveva fallire");
    },
    (error: unknown) => error as UserError,
  );
beforeEach(() => {
  vi.clearAllMocks();
  db.reportClosure.findUnique.mockResolvedValue(null);
  db.cashExpense.findFirst.mockResolvedValue(row());
  db.cashExpense.update.mockImplementation(async ({ data }) =>
    row(data as Record<string, unknown>),
  );
});

it("annulla sotto lock un'uscita del giorno aperto registrando chi e quando", async () => {
  const saved = await cancelExpense(shop, "8", { id: "e1" });
  expect(db.cashExpense.findFirst).toHaveBeenCalledWith({
    where: { id: "e1", shop },
  });
  expect(db.$executeRaw).toHaveBeenCalledOnce();
  expect(db.cashExpense.update).toHaveBeenCalledWith({
    where: { id: "e1" },
    data: { cancelledAt: expect.any(Date), cancelledBy: "8" },
  });
  expect(saved.cancelledBy).toBe("8");
});

it("a giorno chiuso l'uscita non si annulla più", async () => {
  db.reportClosure.findUnique.mockResolvedValue({ id: "closure" });
  const error = await failure(cancelExpense(shop, "8", { id: "e1" }));
  expect(error).toBeInstanceOf(UserError);
  expect(error.status).toBe(409);
  expect(error.message).toMatch(/definitivo/);
  expect(db.cashExpense.update).not.toHaveBeenCalled();
});

it("un'uscita di un altro negozio o inesistente non si trova", async () => {
  db.cashExpense.findFirst.mockResolvedValue(null);
  const error = await failure(cancelExpense(shop, "8", { id: "altrui" }));
  expect(error.status).toBe(404);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("annullare due volte non cambia chi e quando", async () => {
  const already = row({
    cancelledAt: new Date("2026-09-27T12:00:00Z"),
    cancelledBy: "7",
  });
  db.cashExpense.findFirst.mockResolvedValue(already);
  await expect(cancelExpense(shop, "8", { id: "e1" })).resolves.toBe(already);
  expect(db.cashExpense.update).not.toHaveBeenCalled();
});

it("una richiesta senza id valido viene respinta con un messaggio", async () => {
  for (const input of [null, {}, { id: "" }]) {
    const error = await failure(cancelExpense(shop, "8", input));
    expect(error.status).toBe(422);
  }
  expect(db.cashExpense.findFirst).not.toHaveBeenCalled();
});

const expenses: Expense[] = [
  {
    id: "a",
    amountCents: 750,
    reason: "Corriere",
    note: "Ritiro pacchi",
    operatorId: "7",
    createdAt: "2026-09-27T09:30:00Z",
  },
  {
    id: "b",
    amountCents: 4200,
    reason: "Cancelleria",
    note: "Inserita per errore",
    operatorId: "7",
    createdAt: "2026-09-27T10:00:00Z",
    cancelledAt: "2026-09-27T10:05:00Z",
    cancelledBy: "8",
  },
];
const report = () =>
  makeReport({
    date: day,
    shopName: "Test",
    timezone: "Europe/Rome",
    currency: "EUR",
    sales: [],
    movements: [],
    expenses,
    cashGateways: ["cash"],
  });

it("un'uscita annullata resta in elenco ma è fuori da totali e contanti attesi", () => {
  const r = report();
  expect(r.expenses).toHaveLength(2);
  expect(r.expensesTotal).toBe(750);
  expect(r.cashExpected).toBe(-750);
  expect(r.summary.find((m) => m.label === "Uscite di cassa")?.value).toBe(750);
});

it("Excel e PDF mostrano l'annullamento e tengono l'uscita fuori dal totale", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await excel(report())) as never);
  const sheet = book.getWorksheet("Uscite")!;
  expect(sheet.getRow(1).values).toEqual(
    expect.arrayContaining(["Annullata il", "Annullata da"]),
  );
  expect(sheet.getCell("F3").value).toBe("27/09/2026 12:05");
  expect(sheet.getCell("G3").value).toBe("8");
  expect(sheet.getCell("A4").value).toBe("Totale (escluse annullate)");
  expect(sheet.getCell("E4").value).toBe(7.5);
  const main = JSON.stringify(
    book.getWorksheet("Rapportino")!.getSheetValues(),
  );
  expect(main).toContain("Cancelleria (annullata)");
  expect(main).toContain("1 uscita");
  expect(main).toContain("1 annullata");
  const bytes = await pdf(report());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
});
