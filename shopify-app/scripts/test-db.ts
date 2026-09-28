import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Usare esclusivamente un database di test migrato: mai una URL di produzione.
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Impostare TEST_DATABASE_URL su un database di test già migrato",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const createDb = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
const { PrismaSessionStorage } = await import(
  "@shopify/shopify-app-session-storage-prisma"
);
await import("@shopify/shopify-app-remix/adapters/node");
const { Session } = await import("@shopify/shopify-api");
const { addExpense } = await import("../app/expenses.server");
const { default: appDb } = await import("../app/db.server");
const id = randomUUID();
const shop = `test-${id}.myshopify.com`;
const other = `other-${id}.myshopify.com`;
let db = createDb();
try {
  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: "state",
    isOnline: false,
    accessToken: "test-token-only",
    scope: "read_orders,read_products,read_locations",
    expires: new Date(Date.now() + 3600000),
  });
  session.refreshToken = "test-refresh-only";
  session.refreshTokenExpires = new Date(Date.now() + 7200000);
  assert(await new PrismaSessionStorage(db).storeSession(session));
  await db.$disconnect();
  db = createDb();
  const loaded = await new PrismaSessionStorage(db).loadSession(session.id);
  assert.equal(loaded?.accessToken, "test-token-only");
  assert.equal(loaded?.refreshToken, "test-refresh-only");
  const form = new FormData();
  Object.entries({
    date: "2026-09-27",
    amount: "35,00",
    reason: "Corriere",
    note: "Test",
    requestId: id,
  }).forEach(([k, v]) => form.set(k, v));
  await Promise.all([
    addExpense(shop, "123", form),
    addExpense(shop, "123", form),
  ]);
  assert.equal(await db.cashExpense.count({ where: { shop } }), 1);
  assert.equal(
    (await db.cashExpense.findFirst({ where: { shop } }))?.amountCents,
    3500,
  );
  assert.equal(await db.cashExpense.count({ where: { shop: other } }), 0);
  form.set("amount", "-1");
  await assert.rejects(() => addExpense(shop, "123", form));
  // Rapportino definitivo: il database ne impedisce modifica e cancellazione e blocca nuove uscite.
  const { asDefinitive, makeReport } = await import("../app/report");
  const { findClosure, saveClosure, setEmailStatus } = await import(
    "../app/closures.server"
  );
  const closed = asDefinitive(
    makeReport({
      date: "2026-09-27",
      shopName: "Test",
      timezone: "Europe/Rome",
      currency: "EUR",
      sales: [],
      movements: [],
      expenses: [],
      cashGateways: ["cash"],
    }),
    "123",
  );
  await appDb.$transaction((tx) => saveClosure(tx, closed, shop, randomUUID()));
  await setEmailStatus(shop, closed.date, "sent");
  assert.equal((await findClosure(shop, closed.date))?.emailStatus, "sent");
  const closure = { shop_reportDate: { shop, reportDate: closed.date } };
  await assert.rejects(() =>
    db.reportClosure.update({ where: closure, data: { report: {} } }),
  );
  await assert.rejects(() => db.reportClosure.delete({ where: closure }));
  form.set("amount", "10,00");
  form.set("requestId", randomUUID());
  await assert.rejects(() => addExpense(shop, "123", form), /definitivo/);
  await new PrismaSessionStorage(db).deleteSession(session.id);
  assert.equal(
    await new PrismaSessionStorage(db).loadSession(session.id),
    undefined,
  );
  console.log(
    "PASS: PostgreSQL session persistence/reconnect/refresh, expense idempotency, tenant isolation, validation and immutable closures",
  );
} finally {
  // Solo sul database di test: il trigger va sospeso per rimuovere la chiusura sintetica.
  await db.$executeRawUnsafe(
    'ALTER TABLE "ReportClosure" DISABLE TRIGGER "ReportClosure_immutable"',
  );
  await db.reportClosure.deleteMany({ where: { shop } });
  await db.$executeRawUnsafe(
    'ALTER TABLE "ReportClosure" ENABLE TRIGGER "ReportClosure_immutable"',
  );
  await db.cashExpense.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });
  await db.$disconnect();
  await appDb.$disconnect();
}
