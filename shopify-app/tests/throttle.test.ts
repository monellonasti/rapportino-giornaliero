import { afterEach, expect, it, vi } from "vitest";
import { GraphqlQueryError } from "@shopify/shopify-api";
const db = vi.hoisted(() => ({
  cashExpense: { findMany: vi.fn().mockResolvedValue([]) },
  reportClosure: { findUnique: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../app/db.server", () => ({ default: db }));
import { loadReport, throttleWait } from "../app/report.server";

// Risposta THROTTLED come la lancia il client Shopify: errore GraphQL con i dati di costo.
const graphqlError = (code: string, cost?: [number, number, number]) =>
  new GraphqlQueryError({
    message: code,
    response: {} as never,
    body: {
      errors: { graphQLErrors: [{ message: code, extensions: { code } }] },
      ...(cost && {
        extensions: {
          cost: {
            requestedQueryCost: cost[0],
            throttleStatus: {
              currentlyAvailable: cost[1],
              restoreRate: cost[2],
            },
          },
        },
      }),
    } as never,
  });
const empty = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
const shop = {
  shop: { name: "Test", ianaTimezone: "Europe/Rome", currencyCode: "EUR" },
};
const load = (graphql: unknown) =>
  loadReport({ graphql } as never, "verified.myshopify.com", "2026-09-27", [
    "cash",
  ]);
afterEach(() => vi.useRealTimers());

it("aspetta il tempo che serve a ricaricare i punti mancanti, tra 1 e 10 secondi", () => {
  expect(throttleWait(graphqlError("THROTTLED", [500, 100, 50]))).toBe(8000);
  expect(throttleWait(graphqlError("THROTTLED", [120, 100, 50]))).toBe(1000);
  expect(throttleWait(graphqlError("THROTTLED", [5000, 0, 50]))).toBe(10000);
  expect(throttleWait(graphqlError("THROTTLED"))).toBe(1000);
  expect(
    throttleWait(graphqlError("ACCESS_DENIED", [500, 100, 50])),
  ).toBeNull();
  expect(throttleWait(new Error("rete"))).toBeNull();
});

it("se Shopify limita le richieste, attende e riprova invece di far fallire il rapportino", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const responses = [shop, { orders: empty }, { orders: empty }];
  let calls = 0;
  const graphql = vi.fn().mockImplementation(async () => {
    // La prima lettura degli ordini viene rifiutata: mancano 400 punti a 100 punti al secondo.
    if (++calls === 2) throw graphqlError("THROTTLED", [700, 300, 100]);
    return { json: async () => ({ data: responses.shift() }) };
  });
  const pending = load(graphql);
  await vi.advanceTimersByTimeAsync(4000);
  const report = await pending;
  expect(report.orders).toEqual([]);
  expect(graphql).toHaveBeenCalledTimes(4);
  expect(graphql.mock.calls[2][1]).toMatchObject({ tries: 3 });
});

it("dopo troppi tentativi rinuncia e segnala l'errore di Shopify", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const graphql = vi
    .fn()
    .mockRejectedValue(graphqlError("THROTTLED", [500, 0, 50]));
  const pending = load(graphql).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await pending).toBeInstanceOf(GraphqlQueryError);
  expect(graphql).toHaveBeenCalledTimes(5);
});

it("non ritenta gli errori che non dipendono dal limite di velocità", async () => {
  const graphql = vi.fn().mockRejectedValue(graphqlError("ACCESS_DENIED"));
  await expect(load(graphql)).rejects.toBeInstanceOf(GraphqlQueryError);
  expect(graphql).toHaveBeenCalledTimes(1);
});
