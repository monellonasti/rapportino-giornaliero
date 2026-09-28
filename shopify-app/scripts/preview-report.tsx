// Genera anteprima HTML, Excel e PDF del rapportino con dati di esempio,
// senza Shopify né database: `npm run preview:report [-- --ordini 30]`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportView } from "../app/components/ReportView";
import { excel, fileName, pdf } from "../app/export.server";
import {
  asDefinitive,
  makeReport,
  type Line,
  type Order,
  type Transaction,
} from "../app/report";

const money = (amount: string) => ({
  shopMoney: { amount, currencyCode: "EUR" },
});
const line = (
  name: string,
  total: string,
  compareAtPrice: string | null,
  quantity = 1,
): Line => ({
  name,
  quantity,
  originalUnitPriceSet: money(total),
  discountedTotalSet: money(total),
  variant: { compareAtPrice },
});
const sale = (
  id: string,
  gateway: string,
  amount: string,
  processedAt: string,
  kind = "SALE",
): Transaction => ({
  id,
  kind,
  status: "SUCCESS",
  gateway,
  processedAt,
  amountSet: money(amount),
});
function order(
  n: number,
  createdAt: string,
  sourceName: string,
  gateway: string,
  total: string,
  shipping: string,
  lines: Line[],
): Order {
  const tax = (Number(total) - Number(total) / 1.22).toFixed(2);
  return {
    id: `gid://shopify/Order/${n}`,
    name: `#${n}`,
    createdAt,
    sourceName,
    cancelledAt: null,
    test: false,
    paymentGatewayNames: [gateway],
    totalPriceSet: money(total),
    // Negli esempi la differenza tra totale e righe è uno sconto sull'ordine.
    subtotalPriceSet: money((Number(total) - Number(shipping)).toFixed(2)),
    totalTaxSet: money(tax),
    totalShippingPriceSet: money(shipping),
    totalDiscountsSet: money("0"),
    lineItems: {
      nodes: lines,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    transactions: [sale(`t${n}`, gateway, total, createdAt)],
  };
}

const base = [
  order(2547, "2026-07-03T12:46:00Z", "pos", "shopify_payments", "30.50", "0", [
    line(
      "Borsa a tracolla in similpelle con tasca frontale e chiusura magnetica - Nero",
      "29.90",
      "39.90",
    ),
    line("Pile stilo AAA 1,5V - Confezione da 4 pezzi", "2.00", "2.50"),
  ]),
  order(
    2548,
    "2026-07-03T13:21:00Z",
    "web",
    "shopify_payments",
    "32.55",
    "5.90",
    [
      line(
        "Kit regalo relax - Candela profumata, sali da bagno e mascherina",
        "20.25",
        "59.90",
      ),
      line("Portachiavi in pelle intrecciata - Nero", "6.40", "39.90"),
    ],
  ),
  order(
    2549,
    "2026-07-03T14:44:00Z",
    "pos",
    "shopify_payments",
    "100.00",
    "0",
    [
      line(
        "Diffusore di aromi a ultrasuoni multifunzione - Rosa",
        "115.90",
        "145.90",
      ),
    ],
  ),
  order(2550, "2026-07-03T17:26:00Z", "pos", "cash", "60.00", "0", [
    line("Anello in acciaio satinato", "35.00", null),
    line("Articolo personalizzato", "25.00", null),
  ]),
  order(2551, "2026-07-03T17:29:00Z", "pos", "cash", "20.00", "0", [
    line("Confezione regalo", "20.00", null),
  ]),
];
const count = Number(process.argv[process.argv.indexOf("--ordini") + 1]) || 0;
const sales = Array.from({ length: Math.max(count, base.length) }, (_, i) => {
  const o = base[i % base.length];
  if (i < base.length) return o;
  return {
    ...o,
    id: `${o.id}-${i}`,
    name: `#${2547 + i}`,
    transactions: o.transactions.map((t) => ({ ...t, id: `${t.id}-${i}` })),
  };
});
// Rimborso in contanti su un ordine di un giorno precedente.
const refund: Order = {
  ...base[3],
  id: "gid://shopify/Order/2539",
  name: "#2539",
  transactions: [sale("r1", "cash", "10.00", "2026-07-03T16:05:00Z", "REFUND")],
};
const report = makeReport({
  date: "2026-07-03",
  shopName: "Negozio di prova",
  timezone: "Europe/Rome",
  currency: "EUR",
  sales,
  movements: [...sales, refund],
  cashGateways: ["cash", "contanti"],
  expenses: [
    {
      id: "e1",
      amountCents: 500,
      reason: "Corriere",
      note: "Ritiro pacchi GLS",
      operatorId: "81234567890",
      createdAt: "2026-07-03T09:10:00Z",
    },
    {
      id: "e2",
      amountCents: 1250,
      reason: "Cancelleria",
      note: "Rotoli carta per registratore di cassa",
      operatorId: "81234567890",
      createdAt: "2026-07-03T15:40:00Z",
    },
  ],
});

const out = new URL("../preview/", import.meta.url);
mkdirSync(out, { recursive: true });
const css = readFileSync(new URL("../app/style.css", import.meta.url), "utf8");
// Stessi dati in versione bozza e definitiva (chiusa alle 20:30 dall'operatore di esempio).
for (const version of [
  report,
  asDefinitive(report, "81234567890", new Date("2026-07-03T18:30:00Z")),
]) {
  const body = renderToStaticMarkup(
    <main className="app">
      <ReportView report={version} />
    </main>,
  );
  writeFileSync(
    new URL(`rapportino_${version.status}.html`, out),
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anteprima rapportino</title><link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"><style>${css}</style></head><body>${body}</body></html>`,
  );
  writeFileSync(new URL(fileName(version, "xlsx"), out), await excel(version));
  writeFileSync(new URL(fileName(version, "pdf"), out), await pdf(version));
}
console.log(
  `Anteprima bozza e definitiva creata in ${out.pathname} (${report.orders.length} vendite)`,
);
