import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import {
  dateTimeOf,
  euro,
  generatedLabel,
  plural,
  shortDate,
  statusLabel,
  timeOf,
  type MetricFormat,
  type Report,
  type ReportOrder,
} from "../report";
import { argb, palette as P } from "./theme";

type Sheet = ExcelJS.Worksheet;
interface Look {
  font?: Partial<ExcelJS.Font>;
  fill?: string;
  align?: Partial<ExcelJS.Alignment>;
  numFmt?: string;
  border?: Partial<ExcelJS.Borders>;
}

const MONEY = '#,##0.00 "€";-#,##0.00 "€"';
const MONEY_OR_DASH = '#,##0.00 "€";-#,##0.00 "€";"–"';
const PERCENT = "0.0%";
const PERCENT_OR_DASH = '0.0%;-0.0%;"–"';
const LAST = 8; // il foglio principale usa le colonne A:H
const WIDTHS = [42, 7, 16, 14, 14, 12, 11, 15];
// Altezza utile, in punti, di una pagina A4 orizzontale con i margini del foglio.
const PAGE_HEIGHT = 490;
const HEADS = [
  "Prodotto",
  "Q.tà",
  "Prezzo confronto",
  "Prezzo vendita",
  "Tot. confronto",
  "Sconto €",
  "Sconto %",
  "Totale vendita",
];
const LINE_FORMATS = [
  undefined,
  "0",
  MONEY,
  MONEY,
  MONEY,
  MONEY_OR_DASH,
  PERCENT_OR_DASH,
  MONEY,
];
// Riquadri indicatori: tre per riga, su colonne di larghezza simile.
const CARDS = [
  [1, 1],
  [2, 5],
  [6, 8],
];

const color = (hex: string) => ({ argb: argb(hex) });
const font = (f: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: "Aptos",
  size: 10,
  color: color(P.ink),
  ...f,
});
const muted = { color: color(P.muted) };
const edge = (hex: string, style: ExcelJS.BorderStyle = "thin") => ({
  style,
  color: color(hex),
});
const numFmt = (format: MetricFormat) =>
  format === "money" ? MONEY : format === "percent" ? PERCENT : "0";
const cellValue = (value: number, format: MetricFormat) =>
  format === "money" ? value / 100 : value;
const align = (col: number, extra: Partial<ExcelJS.Alignment> = {}) =>
  ({
    horizontal: col === 1 ? "left" : col === 2 ? "center" : "right",
    indent: col === 1 ? 1 : 0,
    vertical: "middle",
    ...extra,
  }) as Partial<ExcelJS.Alignment>;

function paint(ws: Sheet, row: number, from: number, to: number, look: Look) {
  for (let col = from; col <= to; col++) {
    const cell = ws.getCell(row, col);
    if (look.font) cell.font = font(look.font);
    if (look.fill)
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: color(look.fill),
      };
    if (look.align) cell.alignment = look.align;
    if (look.numFmt) cell.numFmt = look.numFmt;
    if (look.border) cell.border = { ...cell.border, ...look.border };
  }
}
function put(
  ws: Sheet,
  row: number,
  from: number,
  value: ExcelJS.CellValue,
  look: Look = {},
  to = from,
) {
  if (to > from) ws.mergeCells(row, from, row, to);
  ws.getCell(row, from).value = value;
  paint(ws, row, from, to, { font: {}, ...look });
}
function height(ws: Sheet, row: number, value: number) {
  ws.getRow(row).height = value;
}
// Stima dell'altezza per i testi a capo: Excel non adatta le righe unite.
const wrapHeight = (text: string, charsPerLine: number, lineHeight = 13.5) =>
  6 + lineHeight * Math.max(1, Math.ceil(text.length / charsPerLine));

function section(ws: Sheet, row: number, title: string, aside = "") {
  const rule = { bottom: edge(P.brand, "medium") };
  put(ws, row, 1, title, {
    font: { size: 13, bold: true },
    align: { vertical: "bottom" },
    border: rule,
  });
  put(
    ws,
    row,
    2,
    aside,
    {
      font: { size: 9, ...muted },
      align: { horizontal: "right", vertical: "bottom" },
      border: rule,
    },
    LAST,
  );
  height(ws, row, 24);
  height(ws, row + 1, 8);
  return row + 2;
}

function header(ws: Sheet, report: Report) {
  const final = report.status === "definitivo";
  put(
    ws,
    1,
    1,
    report.title,
    {
      font: { size: 18, bold: true, color: color(P.white) },
      fill: P.brand,
      align: { vertical: "middle", indent: 1 },
    },
    LAST - 2,
  );
  // Stato in alto a destra: bozza in ambra, definitivo in chiaro sul verde.
  put(
    ws,
    1,
    LAST - 1,
    final ? "DEFINITIVO" : "BOZZA",
    {
      font: {
        size: 12,
        bold: true,
        color: color(final ? P.onBrand : P.warnLine),
      },
      fill: P.brand,
      align: { horizontal: "right", vertical: "middle", indent: 1 },
    },
    LAST,
  );
  height(ws, 1, 36);
  put(
    ws,
    2,
    1,
    {
      richText: [
        {
          text: report.shopName,
          font: font({ size: 10.5, bold: true, color: color(P.white) }),
        },
        {
          text: `   ·   Fuso orario ${report.timezone}   ·   Tutte le sedi   ·   Valori in ${report.currency}   ·   Generato il ${generatedLabel(report)}   ·   ${statusLabel(report)}${report.closedBy ? ` (operatore ${report.closedBy})` : ""}`,
          font: font({ size: 9, color: color(P.onBrand) }),
        },
      ],
    },
    { fill: P.brand, align: { vertical: "top", indent: 1 } },
    LAST,
  );
  height(ws, 2, 22);
  height(ws, 3, 12);
  return 4;
}

function kpis(ws: Sheet, report: Report, top: number) {
  report.kpis.forEach((k, i) => {
    const [from, to] = CARDS[i % CARDS.length];
    const row = top + Math.floor(i / CARDS.length) * 4;
    const fill = k.highlight ? P.accentSoft : P.soft;
    const box = { vertical: "middle", indent: 1 } as const;
    put(
      ws,
      row,
      from,
      k.label,
      {
        font: { size: 9, bold: true, ...muted },
        fill,
        align: { ...box, vertical: "bottom" },
      },
      to,
    );
    put(
      ws,
      row + 1,
      from,
      cellValue(k.value, k.format),
      {
        font: {
          size: 18,
          bold: true,
          color: color(k.highlight ? P.accent : P.ink),
        },
        fill,
        numFmt: numFmt(k.format),
        align: { ...box, horizontal: "left" },
      },
      to,
    );
    put(
      ws,
      row + 2,
      from,
      k.hint,
      { font: { size: 9, ...muted }, fill, align: { ...box, vertical: "top" } },
      to,
    );
    // Bordi bianchi spessi tra i riquadri per staccarli come schede.
    for (let r = row; r <= row + 2; r++) {
      if (from > 1)
        paint(ws, r, from, from, { border: { left: edge(P.white, "thick") } });
      if (to < LAST)
        paint(ws, r, to, to, { border: { right: edge(P.white, "thick") } });
    }
    height(ws, row, 19);
    height(ws, row + 1, 28);
    height(ws, row + 2, 19);
    height(ws, row + 3, 8);
  });
  return top + Math.ceil(report.kpis.length / CARDS.length) * 4 + 1;
}

function order(ws: Sheet, o: ReportOrder, top: number) {
  let r = top;
  const band: Look = { fill: P.accentSoft, align: { vertical: "middle" } };
  put(
    ws,
    r,
    1,
    {
      richText: [
        { text: o.name, font: font({ size: 11, bold: true }) },
        {
          text: `    ${o.time}   ·   ${o.channel}   ·   ${o.payment}`,
          font: font({ color: color(P.ink2) }),
        },
      ],
    },
    { ...band, align: { vertical: "middle", indent: 1 } },
  );
  put(
    ws,
    r,
    2,
    "Totale ordine",
    {
      ...band,
      font: { size: 9, ...muted },
      align: { horizontal: "right", vertical: "middle" },
    },
    LAST - 1,
  );
  put(ws, r, LAST, o.total / 100, {
    ...band,
    font: { size: 11, bold: true },
    numFmt: MONEY,
  });
  height(ws, r++, 24);
  HEADS.forEach((label, i) =>
    put(ws, r, i + 1, label, {
      font: { size: 8.5, bold: true, ...muted },
      align: align(i + 1, { wrapText: true, vertical: "bottom" }),
      border: { bottom: edge(P.lineStrong) },
    }),
  );
  height(ws, r++, 24);
  for (const l of o.lines) {
    const values = [
      l.name,
      l.qty,
      l.compare / 100,
      l.sold / 100,
      (l.compare * l.qty) / 100,
      l.discount / 100,
      l.discountPercent,
      l.total / 100,
    ];
    values.forEach((value, i) =>
      put(ws, r, i + 1, value, {
        font: { bold: i === LAST - 1 },
        numFmt: LINE_FORMATS[i],
        align: align(i + 1, { vertical: "top", wrapText: i === 0 }),
        border: { bottom: edge(P.line) },
      }),
    );
    height(ws, r++, wrapHeight(l.name, 46));
  }
  if (o.lines.length > 1 || o.orderDiscount) {
    const label: ExcelJS.RichText[] = [
      { text: "Totale merce", font: font({ bold: true }) },
    ];
    if (o.orderDiscount)
      label.push({
        text: `   incl. sconto ordine ${euro(o.orderDiscount)}`,
        font: font({ size: 8.5, ...muted }),
      });
    const values = [
      { richText: label },
      o.items,
      null,
      null,
      o.compareTotal / 100,
      o.discount / 100,
      o.discountPercent,
      o.merchandise / 100,
    ];
    values.forEach((value, i) =>
      put(ws, r, i + 1, value, {
        font: { bold: true },
        fill: P.soft,
        numFmt: LINE_FORMATS[i],
        align: align(i + 1),
        border: { top: edge(P.lineStrong) },
      }),
    );
    height(ws, r++, 20);
  }
  // Voci che riconciliano la merce con il totale dell'ordine.
  const extra: [string, number][] = [];
  if (o.shipping) extra.push(["Spedizione", o.shipping]);
  if (o.other) extra.push(["Altre voci dell'ordine", o.other]);
  for (const [label, value] of extra) {
    const look: Look = {
      font: { color: color(P.ink2) },
      border: { bottom: edge(P.line) },
    };
    put(
      ws,
      r,
      1,
      label,
      { ...look, align: { indent: 1, vertical: "middle" } },
      LAST - 1,
    );
    put(ws, r, LAST, value / 100, {
      ...look,
      font: { bold: true },
      numFmt: MONEY,
      align: { vertical: "middle" },
    });
    height(ws, r++, 18);
  }
  height(ws, r, 12);
  return r + 1;
}

function panelTitle(
  ws: Sheet,
  row: number,
  from: number,
  to: number,
  title: string,
) {
  put(
    ws,
    row,
    from,
    title,
    {
      font: { size: 11, bold: true },
      fill: P.soft,
      align: { vertical: "middle", indent: 1 },
    },
    to,
  );
}

function recap(ws: Sheet, report: Report, top: number) {
  const rule = { bottom: edge(P.line) };
  // Colonna sinistra: voci di vendita nell'ordine del rapportino originale.
  panelTitle(ws, top, 1, 3, "Vendite");
  const sales = report.summary.filter((m) => m.group === "vendite");
  sales.forEach((m, i) => {
    const look: Look = {
      font: { bold: m.strong, color: color(m.strong ? P.ink : P.ink2) },
      border: rule,
    };
    put(ws, top + 1 + i, 1, m.label, {
      ...look,
      align: { vertical: "middle", indent: 1 },
    });
    put(
      ws,
      top + 1 + i,
      2,
      cellValue(m.value, m.format),
      {
        ...look,
        numFmt: numFmt(m.format),
        align: { horizontal: "right", vertical: "middle" },
      },
      3,
    );
  });
  // Colonna destra: pagamenti e cassa contanti.
  let r = top;
  panelTitle(ws, r++, 5, 8, "Pagamenti del giorno");
  const heads = {
    font: { size: 8.5, bold: true, ...muted },
    border: { bottom: edge(P.lineStrong) },
  };
  put(
    ws,
    r,
    5,
    "Metodo",
    { ...heads, align: { indent: 1, vertical: "middle" } },
    6,
  );
  put(ws, r, 7, "Incassi", {
    ...heads,
    align: { horizontal: "right", vertical: "middle" },
  });
  put(ws, r++, 8, "Rimborsi", {
    ...heads,
    align: { horizontal: "right", vertical: "middle" },
  });
  if (!report.payments.length)
    put(
      ws,
      r++,
      5,
      "Nessun movimento nel giorno",
      { font: { italic: true, ...muted }, align: { indent: 1 }, border: rule },
      8,
    );
  for (const p of report.payments) {
    const method: ExcelJS.RichText[] = [{ text: p.label, font: font() }];
    if (p.label.toLowerCase() !== p.gateway)
      method.push({
        text: `   ${p.gateway}`,
        font: font({ size: 8.5, ...muted }),
      });
    put(
      ws,
      r,
      5,
      { richText: method },
      { border: rule, align: { indent: 1, vertical: "middle" } },
      6,
    );
    put(ws, r, 7, p.receipts / 100, {
      numFmt: MONEY,
      border: rule,
      align: { vertical: "middle" },
    });
    put(ws, r++, 8, p.refunds / 100, {
      numFmt: MONEY_OR_DASH,
      border: rule,
      align: { vertical: "middle" },
    });
  }
  const totals: Look = {
    font: { bold: true },
    border: { top: edge(P.lineStrong) },
    align: { vertical: "middle" },
  };
  put(
    ws,
    r,
    5,
    "Totale",
    { ...totals, align: { indent: 1, vertical: "middle" } },
    6,
  );
  put(ws, r, 7, report.receiptsTotal / 100, { ...totals, numFmt: MONEY });
  put(ws, r++, 8, report.refundsTotal / 100, {
    ...totals,
    numFmt: MONEY_OR_DASH,
  });
  r++;
  panelTitle(ws, r++, 5, 8, "Cassa contanti");
  const cash: [string, number][] = [
    ["Contanti incassati", report.cashReceipts],
    ["Rimborsi contanti", -report.cashRefunds],
    ["Uscite di cassa", -report.expensesTotal],
  ];
  for (const [label, value] of cash) {
    put(
      ws,
      r,
      5,
      label,
      {
        font: { color: color(P.ink2) },
        border: rule,
        align: { indent: 1, vertical: "middle" },
      },
      7,
    );
    put(ws, r++, 8, value / 100, {
      numFmt: MONEY,
      border: rule,
      align: { vertical: "middle" },
    });
  }
  const expected: Look = {
    font: { bold: true, size: 11, color: color(P.accent) },
    fill: P.accentSoft,
    border: { top: edge(P.brand, "medium") },
    align: { vertical: "middle" },
  };
  put(
    ws,
    r,
    5,
    "Contanti attesi",
    { ...expected, align: { indent: 1, vertical: "middle" } },
    7,
  );
  put(ws, r++, 8, report.cashExpected / 100, {
    ...expected,
    font: { bold: true, size: 12, color: color(P.accent) },
    numFmt: MONEY,
  });
  put(
    ws,
    r++,
    5,
    "Senza fondo cassa iniziale, versamenti e trasferimenti.",
    {
      font: { size: 8.5, italic: true, ...muted },
      align: { indent: 1, vertical: "middle", wrapText: true },
    },
    8,
  );
  const end = Math.max(top + sales.length + 1, r);
  for (let row = top; row < end; row++) height(ws, row, 19);
  height(ws, end, 12);
  return end + 1;
}

function expensesTable(ws: Sheet, report: Report, top: number) {
  let r = section(
    ws,
    top,
    "Uscite di cassa",
    `${plural(report.expenses.length, "uscita", "uscite")}  ·  ${euro(report.expensesTotal)}`,
  );
  const heads = {
    font: { size: 8.5, bold: true, ...muted },
    border: { bottom: edge(P.lineStrong) },
  };
  put(ws, r, 1, "Causale e note", {
    ...heads,
    align: { indent: 1, vertical: "middle" },
  });
  put(ws, r, 2, "Ora", {
    ...heads,
    align: { horizontal: "center", vertical: "middle" },
  });
  put(
    ws,
    r,
    3,
    "Operatore ID",
    { ...heads, align: { vertical: "middle" } },
    LAST - 1,
  );
  put(ws, r, LAST, "Importo", {
    ...heads,
    align: { horizontal: "right", vertical: "middle" },
  });
  height(ws, r++, 20);
  const rule = { bottom: edge(P.line) };
  for (const e of report.expenses) {
    const text: ExcelJS.RichText[] = [
      { text: e.reason, font: font({ bold: true }) },
    ];
    if (e.note)
      text.push({
        text: `  —  ${e.note}`,
        font: font({ color: color(P.ink2) }),
      });
    put(
      ws,
      r,
      1,
      { richText: text },
      { border: rule, align: { indent: 1, vertical: "top", wrapText: true } },
    );
    put(ws, r, 2, timeOf(e.createdAt, report.timezone), {
      border: rule,
      align: { horizontal: "center", vertical: "top" },
    });
    put(
      ws,
      r,
      3,
      e.operatorId,
      { font: { ...muted }, border: rule, align: { vertical: "top" } },
      LAST - 1,
    );
    put(ws, r, LAST, e.amountCents / 100, {
      numFmt: MONEY,
      border: rule,
      align: { vertical: "top" },
    });
    height(ws, r++, wrapHeight(`${e.reason}  —  ${e.note}`, 46));
  }
  const totals: Look = {
    font: { bold: true },
    fill: P.soft,
    border: { top: edge(P.lineStrong) },
    align: { vertical: "middle" },
  };
  put(
    ws,
    r,
    1,
    "Totale uscite",
    { ...totals, align: { indent: 1, vertical: "middle" } },
    LAST - 1,
  );
  put(ws, r, LAST, report.expensesTotal / 100, { ...totals, numFmt: MONEY });
  height(ws, r++, 20);
  height(ws, r, 12);
  return r + 1;
}

function rapportino(book: ExcelJS.Workbook, report: Report) {
  const footer = `Rapportino del ${shortDate(report.date)} · ${report.shopName} · ${
    report.status === "definitivo"
      ? statusLabel(report)
      : "Bozza, non valida come chiusura"
  }`;
  const ws = book.addWorksheet("Rapportino", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.4,
        right: 0.4,
        // Margine alto più ampio: lascia spazio alla scritta "BOZZA" nell'intestazione di pagina.
        top: 0.7,
        bottom: 0.6,
        header: 0.25,
        footer: 0.3,
      },
    },
    headerFooter: {
      // "&" è un codice di formato nell'intestazione Excel: va raddoppiato.
      oddFooter: `&L&8${footer.replace(/&/g, "&&")}&R&8Pagina &P di &N`,
      // Sulla carta la bozza porta "BOZZA" in alto su ogni pagina.
      oddHeader:
        report.status === "definitivo"
          ? undefined
          : `&C&"Aptos,Bold"&18&K${P.warn.slice(1)}BOZZA`,
    },
  });
  ws.columns = WIDTHS.map((width) => ({ width }));
  let r = kpis(ws, report, header(ws, report));
  // Prime righe dei blocchi da non spezzare in stampa.
  const blocks = [1, r];
  const items = report.orders.reduce((n, o) => n + o.items, 0);
  r = section(
    ws,
    r,
    "Dettaglio vendite",
    `${plural(report.orders.length, "vendita", "vendite")}  ·  ${plural(items, "articolo", "articoli")}`,
  );
  if (!report.orders.length) {
    put(
      ws,
      r,
      1,
      "Nessuna vendita nella data scelta.",
      {
        font: { italic: true, ...muted },
        align: { horizontal: "center", vertical: "middle" },
      },
      LAST,
    );
    height(ws, r, 28);
    r += 2;
  }
  report.orders.forEach((o, i) => {
    if (i) blocks.push(r);
    r = order(ws, o, r);
  });
  blocks.push(r);
  r = recap(ws, report, section(ws, r, "Riepilogo giornaliero"));
  if (report.expenses.length) {
    blocks.push(r);
    r = expensesTable(ws, report, r);
  }
  put(
    ws,
    r,
    1,
    "Generato automaticamente dall'app Rapportino Giornaliero · Dettagli nei fogli «Uscite» e «Pagamenti» · Limiti del report nel foglio «Note».",
    {
      font: { size: 8.5, italic: true, ...muted },
      align: { horizontal: "center", vertical: "middle" },
    },
    LAST,
  );
  height(ws, r, 18);
  ws.pageSetup.printArea = `A1:H${r}`;
  pageBreaks(ws, blocks, r + 1);
}

// Interruzioni manuali prima dei blocchi che non entrano nella pagina corrente.
function pageBreaks(ws: Sheet, starts: number[], end: number) {
  let used = 0;
  starts.forEach((start, i) => {
    let block = 0;
    for (let row = start; row < (starts[i + 1] ?? end); row++)
      block += ws.getRow(row).height ?? 15;
    if (used > 0 && used + block > PAGE_HEIGHT) {
      ws.getRow(start - 1).addPageBreak();
      used = 0;
    }
    used = (used + block) % PAGE_HEIGHT;
  });
}

function dataSheet(
  book: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width: number; numFmt?: string }[],
  rows: Record<string, ExcelJS.CellValue>[],
  total?: Record<string, ExcelJS.CellValue>,
) {
  const ws = book.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  ws.columns = columns.map(({ header, key, width }) => ({
    header,
    key,
    width,
  }));
  rows.forEach((row) => ws.addRow(row));
  if (total && rows.length) ws.addRow(total);
  columns.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  paint(ws, 1, 1, columns.length, {
    font: { bold: true, color: color(P.white) },
    fill: P.brand,
    align: { vertical: "middle", indent: 1 },
  });
  height(ws, 1, 24);
  for (let r = 2; r <= ws.rowCount; r++) {
    paint(ws, r, 1, columns.length, {
      font: {},
      border: { bottom: edge(P.line) },
      align: { vertical: "top", wrapText: true },
    });
    const lines = columns.map((c, i) => {
      const value = ws.getCell(r, i + 1).value;
      return typeof value === "string" ? Math.ceil(value.length / c.width) : 1;
    });
    height(ws, r, 6 + 13.5 * Math.max(1, ...lines));
  }
  if (total && rows.length)
    paint(ws, ws.rowCount, 1, columns.length, {
      font: { bold: true },
      fill: P.soft,
      border: { top: edge(P.lineStrong) },
    });
  return ws;
}

export async function excel(report: Report) {
  const book = new ExcelJS.Workbook();
  book.creator = "Rapportino Giornaliero";
  book.created = new Date(report.generatedAt);
  rapportino(book, report);
  dataSheet(
    book,
    "Uscite",
    [
      { header: "Data e ora", key: "createdAt", width: 18 },
      { header: "Causale", key: "reason", width: 26 },
      { header: "Note", key: "note", width: 48 },
      { header: "Operatore ID", key: "operatorId", width: 22 },
      { header: "Importo EUR", key: "amount", width: 16, numFmt: MONEY },
    ],
    report.expenses.map((e) => ({
      createdAt: dateTimeOf(e.createdAt, report.timezone),
      reason: e.reason,
      note: e.note,
      operatorId: e.operatorId,
      amount: e.amountCents / 100,
    })),
    { createdAt: "Totale", amount: report.expensesTotal / 100 },
  );
  dataSheet(
    book,
    "Pagamenti",
    [
      { header: "Metodo", key: "label", width: 22 },
      { header: "Gateway Shopify", key: "gateway", width: 28 },
      { header: "Incassi EUR", key: "receipts", width: 16, numFmt: MONEY },
      { header: "Rimborsi EUR", key: "refunds", width: 16, numFmt: MONEY },
      { header: "Netto EUR", key: "net", width: 16, numFmt: MONEY },
    ],
    report.payments.map((p) => ({
      label: p.label,
      gateway: p.gateway,
      receipts: p.receipts / 100,
      refunds: p.refunds / 100,
      net: (p.receipts - p.refunds) / 100,
    })),
    {
      label: "Totale",
      receipts: report.receiptsTotal / 100,
      refunds: report.refundsTotal / 100,
      net: (report.receiptsTotal - report.refundsTotal) / 100,
    },
  );
  dataSheet(
    book,
    "Note",
    [{ header: "Note di lettura", key: "text", width: 120 }],
    report.warnings.map((text) => ({ text })),
  );
  // Definitivo: fogli protetti con password casuale non salvata, quindi non modificabili.
  if (report.status === "definitivo") {
    const password = randomUUID();
    for (const ws of book.worksheets)
      await ws.protect(password, {
        selectLockedCells: true,
        selectUnlockedCells: true,
      });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
