import { it, expect, vi } from "vitest";
const db = vi.hoisted(() => ({
  cashExpense: { findMany: vi.fn().mockResolvedValue([]) },
  reportClosure: { findUnique: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../app/db.server", () => ({ default: db }));
import { loadReport } from "../app/report.server";
const m = { shopMoney: { amount: "0", currencyCode: "EUR" } };
const page = (
  nodes: unknown[],
  next = false,
  cursor: string | null = null,
) => ({ nodes, pageInfo: { hasNextPage: next, endCursor: cursor } });
it("pagina ordini e articoli, cerca movimenti oltre la data, legge uscite solo dello shop autenticato", async () => {
  const order = {
    id: "1",
    name: "#1",
    createdAt: "2026-09-27T10:00:00Z",
    sourceName: "pos",
    cancelledAt: null,
    test: false,
    totalPriceSet: m,
    totalTaxSet: m,
    totalDiscountsSet: m,
    totalShippingPriceSet: m,
    lineItems: page([], true, "line1"),
  };
  const responses = [
    {
      shop: { name: "Test", ianaTimezone: "Europe/Rome", currencyCode: "EUR" },
    },
    { orders: page([order], true, "order1") },
    { orders: page([]) },
    {
      order: {
        lineItems: page([
          {
            name: "Omaggio",
            quantity: 1,
            originalUnitPriceSet: m,
            discountedTotalSet: m,
            variant: null,
          },
        ]),
      },
    },
    { orders: page([]) },
  ];
  const graphql = vi.fn().mockImplementation(async () => ({
    json: async () => ({ data: responses.shift() }),
  }));
  const report = await loadReport(
    { graphql } as never,
    "verified.myshopify.com",
    "2026-09-27",
    ["cash"],
  );
  expect(report.orders[0].lines).toHaveLength(1);
  expect(graphql).toHaveBeenCalledTimes(5);
  expect(graphql.mock.calls[2][1].variables.cursor).toBe("order1");
  expect(graphql.mock.calls[3][1].variables.cursor).toBe("line1");
  expect(graphql.mock.calls[4][1].variables.query).toBe(
    "updated_at:>='2026-09-26T22:00:00.000Z' status:any",
  );
  expect(db.cashExpense.findMany).toHaveBeenCalledWith({
    where: { shop: "verified.myshopify.com", reportDate: "2026-09-27" },
    orderBy: { createdAt: "asc" },
  });
});
