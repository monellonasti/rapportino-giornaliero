import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => {
  const client = {
    $executeRaw: vi.fn(),
    cashExpense: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    reportClosure: { findUnique: vi.fn(), create: vi.fn() },
  };
  return {
    ...client,
    $transaction: vi.fn((fn: (tx: typeof client) => unknown) => fn(client)),
  };
});
vi.mock("../app/db.server", () => ({ default: db }));
import { closeReport, loadReport } from "../app/report.server";
import { addExpense } from "../app/expenses.server";
import { UserError } from "../app/errors";
import { asDefinitive, makeReport } from "../app/report";

const day = "2026-09-27";
const shop = "verified.myshopify.com";
const emptyOrders = {
  orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
};
const admin = () => {
  const responses = [
    {
      shop: { name: "Test", ianaTimezone: "Europe/Rome", currencyCode: "EUR" },
    },
    emptyOrders,
    emptyOrders,
  ];
  return {
    graphql: vi.fn(async () => ({
      json: async () => ({ data: responses.shift() }),
    })),
  };
};
const stored = () =>
  asDefinitive(
    makeReport({
      date: day,
      shopName: "Test",
      timezone: "Europe/Rome",
      currency: "EUR",
      sales: [],
      movements: [],
      expenses: [],
      cashGateways: ["cash"],
    }),
    "42",
    new Date("2026-09-27T20:00:00Z"),
  );
beforeEach(() => {
  vi.clearAllMocks();
  db.cashExpense.findMany.mockResolvedValue([]);
  db.cashExpense.findUnique.mockResolvedValue(null);
  db.reportClosure.findUnique.mockResolvedValue(null);
});

it("un giorno chiuso mostra la copia definitiva salvata senza ricalcolare gli ordini", async () => {
  const copy = stored();
  db.reportClosure.findUnique.mockResolvedValue({
    report: copy,
    emailStatus: "sent",
  });
  const shopify = admin();
  expect(await loadReport(shopify as never, shop, day, ["cash"])).toEqual(copy);
  expect(shopify.graphql).toHaveBeenCalledTimes(1);
});

it("la stampa definitiva salva sotto lock una copia con le uscite registrate", async () => {
  db.cashExpense.findMany.mockResolvedValue([
    {
      id: "e",
      amountCents: 500,
      reason: "Corriere",
      note: "",
      operatorId: "7",
      createdAt: new Date("2026-09-27T10:00:00Z"),
    },
  ]);
  const result = await closeReport(admin() as never, shop, day, "42", "req-1", [
    "cash",
  ]);
  expect(result.created).toBe(true);
  expect(result.report).toMatchObject({
    status: "definitivo",
    closedBy: "42",
    expensesTotal: 500,
  });
  expect(db.$executeRaw).toHaveBeenCalledOnce();
  expect(db.reportClosure.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      shop,
      reportDate: day,
      operatorId: "42",
      requestId: "req-1",
    }),
  });
});

it("se un altro operatore chiude prima, non crea una seconda copia", async () => {
  db.reportClosure.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ report: stored(), emailStatus: "pending" });
  const result = await closeReport(admin() as never, shop, day, "43", "req-2", [
    "cash",
  ]);
  expect(result).toMatchObject({ created: false, emailStatus: "pending" });
  expect(db.reportClosure.create).not.toHaveBeenCalled();
});

it("rifiuta nuove uscite su un giorno già chiuso", async () => {
  db.reportClosure.findUnique.mockResolvedValue({ id: "closure" });
  const form = new FormData();
  Object.entries({
    date: day,
    amount: "5,00",
    reason: "Corriere",
    note: "",
    requestId: randomUUID(),
  }).forEach(([key, value]) => form.set(key, value));
  await expect(addExpense(shop, "7", form)).rejects.toBeInstanceOf(UserError);
  expect(db.$executeRaw).toHaveBeenCalledOnce();
  expect(db.cashExpense.upsert).not.toHaveBeenCalled();
});

const expenseForm = (values: Record<string, string> = {}) => {
  const form = new FormData();
  Object.entries({
    date: day,
    amount: "5,00",
    reason: "Corriere",
    note: "",
    requestId: randomUUID(),
    ...values,
  }).forEach(([key, value]) => form.set(key, value));
  return form;
};
const savedExpense = (form: FormData) => ({
  id: "e1",
  shop,
  reportDate: day,
  amountCents: 500,
  reason: "Corriere",
  note: "",
  operatorId: "7",
  requestId: String(form.get("requestId")),
  createdAt: new Date(),
});

it("una richiesta ripetuta con gli stessi dati non registra l'uscita due volte", async () => {
  const form = expenseForm();
  db.cashExpense.findUnique.mockResolvedValue(savedExpense(form));
  await expect(addExpense(shop, "7", form)).resolves.toMatchObject({
    amountCents: 500,
  });
  expect(db.cashExpense.upsert).not.toHaveBeenCalled();
});

it("una richiesta ripetuta con un importo diverso viene rifiutata, non registrata col vecchio importo", async () => {
  const form = expenseForm({ amount: "6,00" });
  db.cashExpense.findUnique.mockResolvedValue(savedExpense(form));
  const error = await addExpense(shop, "7", form).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UserError);
  expect((error as UserError).status).toBe(409);
  expect(db.cashExpense.upsert).not.toHaveBeenCalled();
});

it("spiega all'operatore perché un'uscita non è valida", async () => {
  for (const amount of ["abc", "12,345", "2000000"]) {
    const error = await addExpense(shop, "7", expenseForm({ amount })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).status).toBe(422);
    expect((error as UserError).message).toMatch(/[Ii]mporto/);
  }
  expect(db.$transaction).not.toHaveBeenCalled();
});
