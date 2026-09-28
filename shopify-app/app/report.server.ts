import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import db from "./db.server";
import {
  findClosure,
  lockDay,
  saveClosure,
  type Closure,
} from "./closures.server";
import {
  asDefinitive,
  dateRange,
  makeReport,
  type Order,
  type Line,
  type Report,
} from "./report";
import type { requireAdmin } from "./shopify.server";

type Admin = Awaited<ReturnType<typeof requireAdmin>>["admin"];
const lineFields = `name quantity originalUnitPriceSet { shopMoney {amount currencyCode} } discountedTotalSet {shopMoney {amount currencyCode}} variant {compareAtPrice}`;
const moneyFields = `shopMoney {amount currencyCode}`;
const orderFields = `id name createdAt sourceName cancelledAt test paymentGatewayNames
 totalPriceSet {${moneyFields}} subtotalPriceSet {${moneyFields}} totalTaxSet {${moneyFields}} totalShippingPriceSet {${moneyFields}} totalDiscountsSet {${moneyFields}}
 lineItems(first: 20) {nodes {${lineFields}} pageInfo {hasNextPage endCursor}}`;
const movementFields = `id name createdAt test transactions(first: 100) {id kind status gateway processedAt amountSet {${moneyFields}}}`;
async function query<T>(
  admin: Admin,
  document: string,
  variables = {},
): Promise<T> {
  const result = await admin.graphql(document, { variables });
  const body = (await result.json()) as { data?: T; errors?: unknown[] };
  if (body.errors?.length || !body.data)
    throw new Error(
      "Shopify non ha restituito dati completi. Verificare scope e disponibilità API.",
    );
  return body.data as T;
}
export async function shopInfo(admin: Admin) {
  return (
    await query<{
      shop: { name: string; ianaTimezone: string; currencyCode: string };
    }>(admin, `query {shop {name ianaTimezone currencyCode}}`)
  ).shop;
}
async function orders(
  admin: Admin,
  search: string,
  sortKey: "CREATED_AT" | "UPDATED_AT",
) {
  const result: Order[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const data: {
      orders: {
        nodes: Order[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await query(
      admin,
      `query Orders($query: String!, $cursor: String) {orders(first: ${sortKey === "UPDATED_AT" ? 3 : 5}, after: $cursor, query: $query, sortKey: ${sortKey}) {nodes {${sortKey === "UPDATED_AT" ? movementFields : orderFields}} pageInfo {hasNextPage endCursor}}}`,
      { query: search, cursor },
    );
    result.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) return result;
    if (
      !data.orders.pageInfo.endCursor ||
      data.orders.pageInfo.endCursor === cursor
    )
      throw new Error("Paginazione ordini interrotta");
    cursor = data.orders.pageInfo.endCursor;
  }
  throw new Error(
    "Troppi ordini per il report sincrono (200 pagine); serve un job asincrono",
  );
}
async function completeLines(admin: Admin, order: Order) {
  let info = order.lineItems.pageInfo;
  for (let page = 0; info.hasNextPage; page++) {
    if (page >= 100) throw new Error("Troppi articoli nello stesso ordine");
    const data: {
      order: { lineItems: { nodes: Line[]; pageInfo: typeof info } };
    } = await query(
      admin,
      `query Lines($id: ID!, $cursor: String) {order(id: $id) {lineItems(first: 100, after: $cursor) {nodes {${lineFields}} pageInfo {hasNextPage endCursor}}}}`,
      { id: order.id, cursor: info.endCursor },
    );
    if (
      !data.order ||
      (data.order.lineItems.pageInfo.hasNextPage &&
        data.order.lineItems.pageInfo.endCursor === info.endCursor)
    )
      throw new Error("Paginazione articoli interrotta");
    order.lineItems.nodes.push(...data.order.lineItems.nodes);
    info = data.order.lineItems.pageInfo;
  }
}
interface Day {
  date: string;
  info: Awaited<ReturnType<typeof shopInfo>>;
}
async function resolveDay(
  admin: Admin,
  requestedDate: string | null,
): Promise<Day> {
  const info = await shopInfo(admin);
  const date =
    requestedDate || DateTime.now().setZone(info.ianaTimezone).toISODate()!;
  dateRange(date, info.ianaTimezone);
  return { date, info };
}
// Ordini e movimenti Shopify del giorno; le uscite si leggono a parte.
async function fetchOrders(admin: Admin, { date, info }: Day) {
  const { start, end } = dateRange(date, info.ianaTimezone);
  const sales = await orders(
    admin,
    `created_at:>='${start}' created_at:<'${end}' status:any`,
    "CREATED_AT",
  );
  for (const order of sales) await completeLines(admin, order);
  // Nessun limite superiore updated_at: include rimborsi su ordini vecchi e ordini modificati dopo il giorno scelto.
  const movements = await orders(
    admin,
    `updated_at:>='${start}' status:any`,
    "UPDATED_AT",
  );
  return { sales, movements };
}
async function build(
  client: Prisma.TransactionClient,
  shop: string,
  { date, info }: Day,
  data: { sales: Order[]; movements: Order[] },
  cashGateways: string[],
) {
  const expenses = await client.cashExpense.findMany({
    where: { shop, reportDate: date },
    orderBy: { createdAt: "asc" },
  });
  return makeReport({
    date,
    shopName: info.name,
    timezone: info.ianaTimezone,
    currency: info.currencyCode,
    ...data,
    cashGateways,
    expenses: expenses.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
export async function loadReport(
  admin: Admin,
  shop: string,
  requestedDate: string | null,
  cashGateways: string[],
): Promise<Report> {
  const day = await resolveDay(admin, requestedDate);
  // Giorno chiuso: sempre la copia definitiva salvata, mai dati ricalcolati.
  const closure = await findClosure(shop, day.date);
  if (closure) return closure.report;
  return build(db, shop, day, await fetchOrders(admin, day), cashGateways);
}
// Stampa definitiva: salva una sola volta la copia del giorno con le uscite registrate.
export async function closeReport(
  admin: Admin,
  shop: string,
  requestedDate: string | null,
  operatorId: string,
  requestId: string,
  cashGateways: string[],
): Promise<Closure & { created: boolean }> {
  const day = await resolveDay(admin, requestedDate);
  const existing = await findClosure(shop, day.date);
  if (existing) return { ...existing, created: false };
  const data = await fetchOrders(admin, day);
  return db.$transaction(async (tx) => {
    await lockDay(tx, shop, day.date);
    const closed = await findClosure(shop, day.date, tx);
    if (closed) return { ...closed, created: false };
    const report = asDefinitive(
      await build(tx, shop, day, data, cashGateways),
      operatorId,
    );
    await saveClosure(tx, report, shop, requestId);
    return { report, emailStatus: "pending", created: true };
  });
}
