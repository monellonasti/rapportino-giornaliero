import { describe, it, expect } from "vitest";
import {
  dateRange,
  cents,
  euro,
  makeReport,
  paymentLabel,
  type Order,
  type Transaction,
} from "../app/report";
const money = (amount: string) => ({
  shopMoney: { amount, currencyCode: "EUR" },
});
const transaction = (
  id: string,
  amount: string,
  kind = "SALE",
  gateway = "cash",
  processedAt = "2026-09-27T10:00:00Z",
): Transaction => ({
  id,
  kind,
  status: "SUCCESS",
  gateway,
  processedAt,
  amountSet: money(amount),
});
const order = (transactions: Transaction[] = []): Order => ({
  id: "1",
  name: "#1",
  createdAt: "2026-09-27T10:00:00Z",
  sourceName: "pos",
  cancelledAt: null,
  test: false,
  totalPriceSet: money("100"),
  totalTaxSet: money("18.03"),
  totalDiscountsSet: money("0"),
  totalShippingPriceSet: money("0"),
  lineItems: {
    nodes: [
      {
        name: "Scarpa",
        quantity: 1,
        originalUnitPriceSet: money("100"),
        discountedTotalSet: money("100"),
        variant: { compareAtPrice: "120" },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
  transactions,
});
export const fixture = () =>
  makeReport({
    date: "2026-09-27",
    shopName: "Negozio test",
    timezone: "Europe/Rome",
    currency: "EUR",
    sales: [order()],
    movements: [
      order([
        transaction("a", "40"),
        transaction("b", "60", "SALE", "card"),
        transaction("c", "10", "REFUND"),
      ]),
    ],
    expenses: [
      {
        id: "e",
        amountCents: 500,
        reason: "Corriere",
        note: "GLS",
        operatorId: "123",
        createdAt: "2026-09-27T10:00:00Z",
      },
    ],
    cashGateways: ["cash"],
  });
describe("rapportino", () => {
  it("pagamenti misti e rimborsi sottraggono solo i contanti", () => {
    const r = fixture();
    expect(r.cashReceipts).toBe(4000);
    expect(r.cashRefunds).toBe(1000);
    expect(r.cashExpected).toBe(2500);
    expect(r.orders[0].lines[0].discount).toBe(2000);
  });
  it("gestisce ora legale senza perdere l'ultima frazione di secondo", () => {
    const spring = dateRange("2026-03-29", "Europe/Rome"),
      fall = dateRange("2026-10-25", "Europe/Rome");
    expect(Date.parse(spring.end) - Date.parse(spring.start)).toBe(
      23 * 3600000,
    );
    expect(Date.parse(fall.end) - Date.parse(fall.start)).toBe(25 * 3600000);
  });
  it("rifiuta date impossibili e importi imprecisi", () => {
    expect(() => dateRange("2026-02-30", "Europe/Rome")).toThrow();
    expect(cents("1.005")).toBe(101);
  });
  it("non trasforma articoli gratuiti in articoli a prezzo pieno", () => {
    const o = order();
    o.lineItems.nodes[0].discountedTotalSet = money("0");
    o.lineItems.nodes[0].variant = null;
    const r = makeReport({
      date: "2026-09-27",
      shopName: "Test",
      timezone: "Europe/Rome",
      currency: "EUR",
      sales: [o],
      movements: [],
      expenses: [],
      cashGateways: ["cash"],
    });
    expect(r.orders[0].lines[0].sold).toBe(0);
    expect(r.orders[0].lines[0].compare).toBe(0);
  });
  it("include rimborsi su vecchi ordini, esclude tentativi falliti e duplicati", () => {
    const o = order([
      transaction("a", "10", "REFUND"),
      transaction("a", "10", "REFUND"),
      { ...transaction("b", "99"), status: "FAILURE" },
      transaction("c", "100", "SALE", "cash", "2026-09-27T22:00:00Z"),
    ]);
    o.createdAt = "2026-09-01T10:00:00Z";
    const r = makeReport({
      date: "2026-09-27",
      shopName: "Test",
      timezone: "Europe/Rome",
      currency: "EUR",
      sales: [],
      movements: [o],
      expenses: [],
      cashGateways: ["cash"],
    });
    expect(r.cashExpected).toBe(-1000);
  });
  it("prepara ora locale, pagamento e riconciliazione di ogni ordine", () => {
    const o = order();
    o.createdAt = "2026-09-27T08:05:00Z";
    o.paymentGatewayNames = ["gift_card", "cash"];
    // Sconto sull'ordine di 5 €: escluso dal totale di riga, incluso nel subtotale.
    o.totalPriceSet = money("95");
    o.subtotalPriceSet = money("95");
    const r = makeReport({
      date: "2026-09-27",
      shopName: "Test",
      timezone: "Europe/Rome",
      currency: "EUR",
      sales: [o],
      movements: [],
      expenses: [],
      cashGateways: ["cash"],
    });
    expect(r.title).toBe("Rapportino della domenica 27 settembre 2026");
    expect(r.orders[0]).toMatchObject({
      time: "10:05",
      payment: "Gift card + Contanti",
      merchandise: 9500,
      orderDiscount: 500,
      discount: 2500,
      other: 0,
    });
    expect(r.summary.find((m) => m.label === "Totale merce")?.value).toBe(9500);
    expect(r.kpis.at(-1)).toMatchObject({ label: "Contanti attesi", value: 0 });
    // Senza subtotale (dati parziali) la merce resta la somma delle righe.
    expect(fixture().orders[0]).toMatchObject({ orderDiscount: 0, other: 0 });
  });
  it("formatta gli importi all'italiana senza zeri negativi", () => {
    expect(euro(123450)).toBe("1.234,50\xa0€");
    expect(euro(-0)).toBe("0,00\xa0€");
  });
  it("traduce i gateway in metodi di pagamento leggibili", () => {
    expect(paymentLabel("shopify_payments")).toBe("Carta");
    expect(paymentLabel("gift_card")).toBe("Gift card");
    expect(paymentLabel("Cash on Delivery (COD)")).toBe("Contrassegno");
    expect(paymentLabel("cassa negozio", ["cassa negozio"])).toBe("Contanti");
    expect(paymentLabel("deposito")).toBe("deposito");
  });
  it("blocca transazioni potenzialmente troncate", () => {
    expect(() =>
      makeReport({
        date: "2026-09-27",
        shopName: "Test",
        timezone: "Europe/Rome",
        currency: "EUR",
        sales: [],
        movements: [
          order(
            Array.from({ length: 100 }, (_, i) => transaction(String(i), "1")),
          ),
        ],
        expenses: [],
        cashGateways: ["cash"],
      }),
    ).toThrow(/100 transazioni/);
  });
});
