import Decimal from "decimal.js";
import { DateTime } from "luxon";

export function cents(value: string | number) {
  const n = new Decimal(value)
    .times(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  if (!Number.isSafeInteger(n)) throw new Error("Importo fuori intervallo");
  return n;
}
export function dateRange(date: string, zone: string) {
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !start.isValid ||
    start.toISODate() !== date
  )
    throw new Error("Data non valida");
  return {
    start: start.toUTC().toISO()!,
    end: start.plus({ days: 1 }).toUTC().toISO()!,
  };
}
export interface Money {
  shopMoney: { amount: string; currencyCode: string };
}
export interface Line {
  name: string;
  quantity: number;
  originalUnitPriceSet: Money;
  discountedTotalSet: Money;
  variant: { compareAtPrice: string | null } | null;
}
export interface Transaction {
  id: string;
  kind: string;
  status: string;
  gateway: string | null;
  processedAt: string | null;
  amountSet: Money;
}
export interface Order {
  id: string;
  name: string;
  createdAt: string;
  sourceName: string;
  cancelledAt: string | null;
  test: boolean;
  // Richiesti solo per gli ordini di vendita, non per i movimenti.
  paymentGatewayNames?: string[];
  // Merce dopo tutti gli sconti, compresi quelli sull'ordine esclusi dalle righe.
  subtotalPriceSet?: Money;
  totalPriceSet: Money;
  totalTaxSet: Money;
  totalShippingPriceSet: Money;
  totalDiscountsSet: Money;
  lineItems: {
    nodes: Line[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  transactions: Transaction[];
}
export interface Expense {
  id: string;
  amountCents: number;
  reason: string;
  note: string;
  operatorId: string;
  createdAt: string;
}
export type MetricFormat = "money" | "number" | "percent";
export interface Metric {
  label: string;
  value: number;
  format: MetricFormat;
  group: "vendite" | "pagamenti" | "cassa";
  strong?: boolean;
}
export interface Kpi {
  label: string;
  value: number;
  format: MetricFormat;
  hint: string;
  highlight?: boolean;
}
export interface ReportLine {
  name: string;
  qty: number;
  compare: number;
  sold: number;
  total: number;
  discount: number;
  discountPercent: number;
}
export interface ReportOrder {
  id: string;
  name: string;
  channel: string;
  time: string;
  payment: string;
  total: number;
  items: number;
  compareTotal: number;
  // Merce dopo tutti gli sconti; sconto e percentuale includono lo sconto sull'ordine.
  merchandise: number;
  discount: number;
  discountPercent: number;
  // Sconto sull'ordine non attribuito alle righe (es. arrotondamento in cassa).
  orderDiscount: number;
  shipping: number;
  // Resto del totale ordine oltre merce e spedizione (tasse escluse, mance…).
  other: number;
  lines: ReportLine[];
}
export interface Report {
  date: string;
  title: string;
  // "definitivo": copia salvata alla stampa definitiva, non più modificabile.
  status: "bozza" | "definitivo";
  closedAt?: string;
  closedBy?: string;
  generatedAt: string;
  shopName: string;
  timezone: string;
  currency: string;
  orders: ReportOrder[];
  kpis: Kpi[];
  summary: Metric[];
  expenses: Expense[];
  expensesTotal: number;
  payments: {
    gateway: string;
    label: string;
    receipts: number;
    refunds: number;
  }[];
  receiptsTotal: number;
  refundsTotal: number;
  cashReceipts: number;
  cashRefunds: number;
  cashExpected: number;
  warnings: string[];
}

const euroFormat = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  useGrouping: true,
});
const percentFormat = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
// `|| 0` evita "-0,00 €" quando si nega un importo nullo.
export const euro = (c: number) => euroFormat.format(c / 100 || 0);
export const percent = (value: number) => percentFormat.format(value);
export const displayMetric = (m: { value: number; format: MetricFormat }) =>
  m.format === "money"
    ? euro(m.value)
    : m.format === "percent"
      ? percent(m.value)
      : String(m.value);
export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
// Formattazione date con Intl: usata anche nel browser, senza caricare luxon.
const format = (
  iso: string,
  zone: string,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat("it-IT", { timeZone: zone, ...options }).format(
    new Date(iso),
  );
export const timeOf = (iso: string, zone: string) =>
  format(iso, zone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayOf = (iso: string, zone: string) =>
  format(iso, zone, { day: "2-digit", month: "2-digit", year: "numeric" });
export const dateTimeOf = (iso: string, zone: string) =>
  `${dayOf(iso, zone)} ${timeOf(iso, zone)}`;
export const shortDate = (date: string) => date.split("-").reverse().join("/");
export const generatedLabel = (report: Report) =>
  `${dayOf(report.generatedAt, report.timezone)} alle ${timeOf(report.generatedAt, report.timezone)}`;
// Stato mostrato su pagina, stampa, Excel e PDF.
export const statusLabel = (report: Report) =>
  report.status === "definitivo" && report.closedAt
    ? `Definitivo · chiuso il ${dayOf(report.closedAt, report.timezone)} alle ${timeOf(report.closedAt, report.timezone)}`
    : "Bozza · i dati possono ancora cambiare";
// Copia definitiva: stessi dati della bozza, marcati come chiusi dall'operatore.
export const asDefinitive = (
  report: Report,
  operatorId: string,
  closedAt = new Date(),
): Report => ({
  ...report,
  status: "definitivo",
  closedAt: closedAt.toISOString(),
  closedBy: operatorId,
});

// Etichetta leggibile del gateway; il nome tecnico resta disponibile nei dati.
export function paymentLabel(gateway: string, cashGateways: string[] = []) {
  const g = gateway.trim().toLowerCase();
  if (!g || g === "non specificato") return "Non specificato";
  if (cashGateways.includes(g)) return "Contanti";
  if (/delivery|\bcod\b|contrassegno/.test(g)) return "Contrassegno";
  if (/cash|contant/.test(g)) return "Contanti";
  if (g.includes("gift")) return "Gift card";
  if (g.includes("paypal")) return "PayPal";
  if (/bank|bonifico|transfer/.test(g)) return "Bonifico";
  if (
    /shopify.?payments|stripe|card|carta|visa|mastercard|maestro|amex|\bpos\b/.test(
      g,
    )
  )
    return "Carta";
  if (g === "manual") return "Manuale";
  return gateway.trim();
}

export function makeReport(input: {
  date: string;
  shopName: string;
  timezone: string;
  currency: string;
  sales: Order[];
  movements: Order[];
  expenses: Expense[];
  cashGateways: string[];
}): Report {
  const { start, end } = dateRange(input.date, input.timezone);
  if (input.currency !== "EUR")
    throw new Error(
      "Questa versione del rapportino supporta solo negozi in EUR",
    );
  const amount = (m: Money) => {
    if (m.shopMoney.currencyCode !== input.currency)
      throw new Error("Valuta inattesa");
    return cents(m.shopMoney.amount);
  };
  const sales = input.sales.filter((o) => !o.test && !o.cancelledAt);
  let qty = 0,
    compareTotal = 0,
    merchandise = 0;
  const orders = sales.map((o) => {
    let items = 0,
      orderCompare = 0,
      linesTotal = 0;
    const lines = o.lineItems.nodes.map((l) => {
      const total = amount(l.discountedTotalSet);
      const sold = l.quantity
        ? new Decimal(total)
            .div(l.quantity)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber()
        : 0;
      const compare =
        l.variant?.compareAtPrice && cents(l.variant.compareAtPrice) > 0
          ? cents(l.variant.compareAtPrice)
          : sold;
      const list = compare * l.quantity;
      items += l.quantity;
      orderCompare += list;
      linesTotal += total;
      return {
        name: l.name,
        qty: l.quantity,
        compare,
        sold,
        total,
        discount: list - total,
        discountPercent: list ? (list - total) / list : 0,
      };
    });
    // I totali di riga escludono gli sconti sull'ordine, il subtotale Shopify li comprende.
    const orderMerchandise = o.subtotalPriceSet
      ? amount(o.subtotalPriceSet)
      : linesTotal;
    qty += items;
    compareTotal += orderCompare;
    merchandise += orderMerchandise;
    const total = amount(o.totalPriceSet);
    const shipping = amount(o.totalShippingPriceSet);
    const payments = [
      ...new Set(
        (o.paymentGatewayNames || []).map((g) =>
          paymentLabel(g, input.cashGateways),
        ),
      ),
    ];
    return {
      id: o.id,
      name: o.name,
      channel:
        o.sourceName === "pos"
          ? "POS"
          : o.sourceName === "web"
            ? "Online"
            : o.sourceName || "Altro",
      time: timeOf(o.createdAt, input.timezone),
      payment: payments.join(" + ") || "Non specificato",
      total,
      items,
      compareTotal: orderCompare,
      merchandise: orderMerchandise,
      discount: orderCompare - orderMerchandise,
      discountPercent: orderCompare
        ? (orderCompare - orderMerchandise) / orderCompare
        : 0,
      orderDiscount: linesTotal - orderMerchandise,
      shipping,
      other: total - orderMerchandise - shipping,
      lines,
    };
  });
  const payments = new Map<
    string,
    { gateway: string; label: string; receipts: number; refunds: number }
  >();
  const seen = new Set<string>();
  let cashReceipts = 0,
    cashRefunds = 0;
  const warnings = [
    "Vendite: ordini creati nel giorno, esclusi test e annullati; valori originali, non una chiusura fiscale. Rimborsi e incassi sono movimenti separati del giorno.",
    "Prezzo confronto: valore attuale del catalogo, non storico. Sconti confronto diversi dagli sconti applicati da Shopify.",
    "Contanti attesi senza fondo iniziale, versamenti o trasferimenti; totale di tutte le sedi. Verificare i gateway contanti e confrontare con Shopify POS.",
  ];
  for (const o of input.movements) {
    if (o.test) continue;
    if (o.transactions.length >= 100)
      throw new Error(
        `Ordine ${o.name}: limite di 100 transazioni raggiunto; report bloccato per evitare totali incompleti`,
      );
    for (const t of o.transactions) {
      if (
        seen.has(t.id) ||
        t.status !== "SUCCESS" ||
        !["SALE", "CAPTURE", "REFUND"].includes(t.kind)
      )
        continue;
      seen.add(t.id);
      if (!t.processedAt) throw new Error(`Transazione senza data: ${o.name}`);
      const time = Date.parse(t.processedAt);
      if (time < Date.parse(start) || time >= Date.parse(end)) continue;
      const gateway = t.gateway?.trim().toLowerCase() || "non specificato";
      const value = amount(t.amountSet);
      const p = payments.get(gateway) || {
        gateway,
        label: paymentLabel(gateway, input.cashGateways),
        receipts: 0,
        refunds: 0,
      };
      if (t.kind === "REFUND") {
        p.refunds += value;
        if (input.cashGateways.includes(gateway)) cashRefunds += value;
      } else {
        p.receipts += value;
        if (input.cashGateways.includes(gateway)) cashReceipts += value;
      }
      payments.set(gateway, p);
    }
  }
  const total = sales.reduce((n, o) => n + amount(o.totalPriceSet), 0);
  const tax = sales.reduce((n, o) => n + amount(o.totalTaxSet), 0);
  const shipping = sales.reduce(
    (n, o) => n + amount(o.totalShippingPriceSet),
    0,
  );
  const discounts = sales.reduce((n, o) => n + amount(o.totalDiscountsSet), 0);
  const expenses = input.expenses.reduce((n, e) => n + e.amountCents, 0);
  const metric =
    (group: Metric["group"], format: MetricFormat) =>
    (label: string, value: number, strong = false): Metric => ({
      label,
      value,
      format,
      group,
      strong,
    });
  const money = metric("vendite", "money");
  const number = metric("vendite", "number");
  const share = metric("vendite", "percent");
  const cashExpected = cashReceipts - cashRefunds - expenses;
  const paymentRows = [...payments.values()];
  const receiptsTotal = paymentRows.reduce((n, p) => n + p.receipts, 0);
  const refundsTotal = paymentRows.reduce((n, p) => n + p.refunds, 0);
  const compareDiscount = compareTotal - merchandise;
  const compareRate = compareTotal ? compareDiscount / compareTotal : 0;
  const average = orders.length ? Math.round(total / orders.length) : 0;
  if (Date.parse(start) < Date.now() - 60 * 86400000)
    warnings.push(
      "Data oltre 60 giorni: con i soli scope standard Shopify può non restituire gli ordini storici. Richiedere read_all_orders per report storici completi.",
    );
  warnings.push(
    "I movimenti su ordini oltre la finestra di accesso Shopify possono mancare anche in un report di oggi.",
  );
  const day = DateTime.fromISO(input.date, { zone: input.timezone }).setLocale(
    "it",
  );
  return {
    date: input.date,
    // "Rapportino del venerdì …", ma "della domenica …" (femminile).
    title: `Rapportino ${day.weekday === 7 ? "della" : "del"} ${day.toFormat("cccc d LLLL yyyy")}`,
    status: "bozza",
    generatedAt: new Date().toISOString(),
    shopName: input.shopName,
    timezone: input.timezone,
    currency: input.currency,
    orders,
    expenses: input.expenses,
    expensesTotal: expenses,
    payments: paymentRows,
    receiptsTotal,
    refundsTotal,
    cashReceipts,
    cashRefunds,
    cashExpected,
    warnings,
    kpis: [
      {
        label: "Vendite IVA inclusa",
        value: total,
        format: "money",
        hint: "Spedizioni incluse",
      },
      {
        label: "Vendite IVA esclusa",
        value: total - tax,
        format: "money",
        hint: `IVA ${euro(tax)}`,
      },
      {
        label: "Sconto totale",
        value: compareDiscount,
        format: "money",
        hint: `${percent(compareRate)} sul prezzo confronto`,
      },
      {
        label: "Numero vendite",
        value: orders.length,
        format: "number",
        hint: plural(qty, "articolo venduto", "articoli venduti"),
      },
      {
        label: "Scontrino medio",
        value: average,
        format: "money",
        hint: "IVA inclusa",
      },
      {
        label: "Contanti attesi",
        value: cashExpected,
        format: "money",
        hint: "Senza fondo cassa",
        highlight: true,
      },
    ],
    // Ordine delle voci di vendita come nel rapportino originale.
    summary: [
      money("Totale vendite IVA inclusa", total, true),
      money("Totale vendite IVA esclusa", total - tax, true),
      money("Sconto confronto totale", compareDiscount, true),
      share("Sconto confronto medio", compareRate),
      money("Sconti applicati Shopify", discounts),
      money("Totale merce", merchandise),
      money("Totale spedizione", shipping),
      number("Numero vendite", orders.length),
      share(
        "Percentuale Online",
        orders.length
          ? orders.filter((o) => o.channel === "Online").length / orders.length
          : 0,
      ),
      share(
        "Percentuale POS",
        orders.length
          ? orders.filter((o) => o.channel === "POS").length / orders.length
          : 0,
      ),
      number("Articoli venduti", qty),
      money("Scontrino medio", average),
      metric("pagamenti", "money")(
        "Incassi riusciti del giorno",
        receiptsTotal,
      ),
      metric("pagamenti", "money")(
        "Rimborsi riusciti del giorno",
        refundsTotal,
      ),
      metric("cassa", "money")("Contanti incassati", cashReceipts),
      metric("cassa", "money")("Rimborsi contanti", cashRefunds),
      metric("cassa", "money")("Uscite di cassa", expenses),
      metric("cassa", "money")(
        "Contanti attesi (senza fondo)",
        cashExpected,
        true,
      ),
    ],
  };
}
