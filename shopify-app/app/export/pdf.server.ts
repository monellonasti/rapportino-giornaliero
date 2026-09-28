import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import {
  displayMetric,
  euro,
  generatedLabel,
  percent,
  plural,
  shortDate,
  statusLabel,
  timeOf,
  type Report,
  type ReportLine,
  type ReportOrder,
} from "../report";
import { palette as P } from "./theme";

type Doc = PDFKit.PDFDocument;
type Align = "left" | "right" | "center";
interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: string;
}
interface Column {
  label: string;
  x: number;
  width: number;
  align: Align;
}

const MARGIN = 36;
const PAD = 7;
const ROW = 16;
const BAND = 20;
// Altezza massima di un blocco (ordine, tabella) da non spezzare tra due pagine.
const KEEP = 200;
const DASH = "–";

// I font standard PDF usano la codifica WinAnsi: i caratteri non rappresentabili
// diventano "?" invece di corrompere l'impaginazione.
const clean = (s: string) =>
  s.replace(/[^\x20-\x7e\xa0-\xff€–—‘’“”•…\n]/g, "?");

class Page {
  y = MARGIN;
  readonly left = MARGIN;
  readonly width: number;
  readonly bottom: number;
  constructor(readonly doc: Doc) {
    this.width = doc.page.width - 2 * MARGIN;
    this.bottom = doc.page.height - MARGIN;
  }
  get right() {
    return this.left + this.width;
  }
  // Va a pagina nuova se il blocco non entra; `repeat` ridisegna le intestazioni.
  ensure(height: number, repeat?: () => void) {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = MARGIN;
    repeat?.();
  }
  style({ size = 9, bold = false, color = P.ink }: TextStyle) {
    return this.doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .fillColor(color);
  }
  // Testo su una riga, accorciato con "…" se supera la larghezza disponibile.
  text(
    value: string,
    x: number,
    y: number,
    style: TextStyle & { width?: number; align?: Align } = {},
  ) {
    const doc = this.style(style);
    let s = clean(value);
    if (style.width !== undefined && doc.widthOfString(s) > style.width) {
      while (s.length > 1 && doc.widthOfString(`${s}…`) > style.width)
        s = s.slice(0, -1);
      s = `${s.trimEnd()}…`;
    }
    const w = doc.widthOfString(s);
    const room = style.width ?? w;
    const offset =
      style.align === "right"
        ? room - w
        : style.align === "center"
          ? (room - w) / 2
          : 0;
    doc.text(s, x + offset, y, { lineBreak: false });
    return w;
  }
  paragraph(
    value: string,
    x: number,
    y: number,
    width: number,
    style: TextStyle = {},
  ) {
    this.style(style).text(clean(value), x, y, { width, lineGap: 1 });
  }
  measure(value: string, width: number, style: TextStyle = {}) {
    return this.style(style).heightOfString(clean(value), {
      width,
      lineGap: 1,
    });
  }
  rule(
    y: number,
    color = P.line,
    weight = 0.5,
    x1 = this.left,
    x2 = this.right,
  ) {
    this.doc
      .moveTo(x1, y)
      .lineTo(x2, y)
      .lineWidth(weight)
      .strokeColor(color)
      .stroke();
  }
  box(x: number, y: number, w: number, h: number, fill: string, radius = 6) {
    this.doc.roundedRect(x, y, w, h, radius).fill(fill);
  }
}

function columns(
  pg: Page,
  specs: { label: string; width: number; align: Align }[],
): Column[] {
  // La colonna con larghezza 0 prende lo spazio rimanente.
  const flex = pg.width - specs.reduce((n, c) => n + c.width, 0);
  let x = pg.left;
  return specs.map((c) => {
    const column = { ...c, x, width: c.width || flex };
    x += column.width;
    return column;
  });
}

function tableHead(pg: Page, cols: Column[]) {
  cols.forEach((c) =>
    pg.text(c.label, c.x + PAD, pg.y + 4, {
      size: 7.5,
      bold: true,
      color: P.muted,
      width: c.width - 2 * PAD,
      align: c.align,
    }),
  );
  pg.y += 15;
  pg.rule(pg.y, P.lineStrong, 0.6);
  pg.y += 4;
}

function section(pg: Page, title: string, aside = "", need = 0) {
  pg.ensure(28 + need);
  pg.text(title, pg.left, pg.y, { size: 12.5, bold: true });
  if (aside)
    pg.text(aside, pg.left, pg.y + 3.5, {
      size: 8.5,
      color: P.muted,
      width: pg.width,
      align: "right",
    });
  pg.y += 19;
  pg.rule(pg.y, P.brand, 1);
  pg.y += 8;
}

function header(pg: Page, report: Report) {
  const top = pg.y;
  const eyebrow = pg.text("RAPPORTINO GIORNALIERO", pg.left, top, {
    size: 7.5,
    bold: true,
    color: P.accent,
  });
  // Stato accanto all'intestazione: bozza in ambra, definitivo nel colore dell'app.
  const final = report.status === "definitivo";
  const tag = final ? "DEFINITIVO" : "BOZZA";
  const tagWidth = pg.style({ size: 7, bold: true }).widthOfString(tag) + 12;
  const tagX = pg.left + eyebrow + 10;
  pg.box(tagX, top - 3, tagWidth, 13, final ? P.accent : P.warnSoft, 6.5);
  pg.text(tag, tagX + 6, top, {
    size: 7,
    bold: true,
    color: final ? P.white : P.warn,
  });
  const detail = statusLabel(report).split(" · ").slice(1).join(" · ");
  pg.text(
    detail + (report.closedBy ? ` · operatore ${report.closedBy}` : ""),
    tagX + tagWidth + 8,
    top,
    { size: 7.5, color: P.muted, width: pg.width / 2 },
  );
  pg.text(report.title, pg.left, top + 12, {
    size: 20,
    bold: true,
    width: pg.width,
  });
  pg.text(report.shopName, pg.left, top + 42, {
    size: 11,
    bold: true,
    color: P.ink2,
    width: pg.width * 0.5,
  });
  // Dati del report allineati a destra, come nell'anteprima.
  const meta: [string, string][] = [
    ["Fuso orario", report.timezone],
    ["Sedi", "Tutte"],
    ["Valuta", report.currency],
    ["Generato", generatedLabel(report)],
  ];
  let x = pg.right;
  for (const [label, value] of meta.reverse()) {
    const w = Math.max(
      pg.style({ size: 7 }).widthOfString(label),
      pg.style({ size: 8.5 }).widthOfString(clean(value)),
    );
    x -= w;
    pg.text(label, x, top + 38, { size: 7, color: P.muted });
    pg.text(value, x, top + 48, { size: 8.5 });
    x -= 18;
  }
  pg.y = top + 60;
  pg.doc.rect(pg.left, pg.y, pg.width, 2).fill(P.brand);
  pg.y += 14;
}

function kpis(pg: Page, report: Report) {
  const gap = 8;
  const h = 52;
  const w = (pg.width - gap * (report.kpis.length - 1)) / report.kpis.length;
  report.kpis.forEach((k, i) => {
    const x = pg.left + i * (w + gap);
    const value = displayMetric(k);
    let size = 16;
    while (
      size > 10 &&
      pg.style({ size, bold: true }).widthOfString(clean(value)) > w - 20
    )
      size -= 0.5;
    pg.box(x, pg.y, w, h, k.highlight ? P.accentSoft : P.soft);
    pg.text(k.label, x + 10, pg.y + 9, {
      size: 7.5,
      bold: true,
      color: P.muted,
      width: w - 20,
    });
    pg.text(value, x + 10, pg.y + 21, {
      size,
      bold: true,
      color: k.highlight ? P.accent : P.ink,
    });
    pg.text(k.hint, x + 10, pg.y + 40, {
      size: 7.5,
      color: P.muted,
      width: w - 20,
    });
  });
  pg.y += h + 16;
}

function orderBand(pg: Page, o: ReportOrder, continued: boolean) {
  const y = pg.y + 5.5;
  pg.box(pg.left, pg.y, pg.width, BAND, P.accentSoft, 5);
  const w = pg.text(o.name, pg.left + 10, y, { size: 10, bold: true });
  pg.text(
    continued
      ? "continua dalla pagina precedente"
      : `${o.time}   ·   ${o.channel}   ·   ${o.payment}`,
    pg.left + w + 20,
    y + 0.5,
    { size: 9, color: P.ink2, width: pg.width - w - 240 },
  );
  if (!continued) {
    const value = pg.text(euro(o.total), pg.left, y, {
      size: 10,
      bold: true,
      width: pg.width - 10,
      align: "right",
    });
    pg.text("Totale ordine", pg.left, y + 1, {
      size: 8,
      color: P.muted,
      width: pg.width - 18 - value,
      align: "right",
    });
  }
  pg.y += BAND;
}

function cells(
  pg: Page,
  cols: Column[],
  values: string[],
  y: number,
  style: TextStyle = {},
) {
  values.forEach((value, i) => {
    const c = cols[i + 1];
    if (value)
      pg.text(value, c.x + PAD, y, {
        size: 9,
        ...style,
        bold: style.bold || i === values.length - 1,
        color: value === DASH ? P.muted : style.color,
        width: c.width - 2 * PAD,
        align: "right",
      });
  });
}

function lineRow(pg: Page, cols: Column[], l: ReportLine, h: number) {
  const y = pg.y + 4;
  pg.paragraph(l.name, cols[0].x + PAD, y, cols[0].width - 2 * PAD, {
    size: 9,
  });
  cells(
    pg,
    cols,
    [
      String(l.qty),
      euro(l.compare),
      euro(l.sold),
      l.discount ? euro(l.discount) : DASH,
      l.discount ? percent(l.discountPercent) : DASH,
      euro(l.total),
    ],
    y,
  );
  pg.y += h;
  pg.rule(pg.y);
}

function orderFooter(o: ReportOrder) {
  const rows: {
    label: string;
    note?: string;
    values: string[];
    strong?: boolean;
  }[] = [];
  if (o.lines.length > 1 || o.orderDiscount)
    rows.push({
      label: "Totale merce",
      note: o.orderDiscount
        ? `incl. sconto ordine ${euro(o.orderDiscount)}`
        : undefined,
      values: [
        String(o.items),
        "",
        "",
        o.discount ? euro(o.discount) : DASH,
        o.discount ? percent(o.discountPercent) : DASH,
        euro(o.merchandise),
      ],
      strong: true,
    });
  const only = (value: number) => ["", "", "", "", "", euro(value)];
  if (o.shipping) rows.push({ label: "Spedizione", values: only(o.shipping) });
  if (o.other)
    rows.push({ label: "Altre voci dell'ordine", values: only(o.other) });
  return rows;
}

function order(pg: Page, cols: Column[], o: ReportOrder) {
  const footer = orderFooter(o);
  const footerHeight = footer.length * ROW;
  const heights = o.lines.map((l) =>
    Math.max(ROW, pg.measure(l.name, cols[0].width - 2 * PAD, { size: 9 }) + 8),
  );
  // Gli ordini brevi restano interi; quelli lunghi proseguono ripetendo intestazioni e numero ordine.
  const block = BAND + heights.reduce((n, h) => n + h, 0) + footerHeight;
  pg.ensure(
    block <= KEEP
      ? block
      : BAND + (heights[0] ?? 0) + (heights.length < 2 ? footerHeight : 0),
    () => tableHead(pg, cols),
  );
  orderBand(pg, o, false);
  heights.forEach((h, i) => {
    pg.ensure(h + (i === heights.length - 1 ? footerHeight : 0), () => {
      tableHead(pg, cols);
      orderBand(pg, o, true);
    });
    lineRow(pg, cols, o.lines[i], h);
  });
  for (const row of footer) {
    if (row.strong) pg.doc.rect(pg.left, pg.y, pg.width, ROW).fill(P.soft);
    const y = pg.y + 4;
    const w = pg.text(row.label, cols[0].x + PAD, y, {
      size: 9,
      bold: row.strong,
      color: row.strong ? P.ink : P.ink2,
    });
    if (row.note)
      pg.text(row.note, cols[0].x + PAD + w + 10, y + 1, {
        size: 7.5,
        color: P.muted,
        width: cols[0].width - w - 2 * PAD - 10,
      });
    cells(pg, cols, row.values, y, { bold: row.strong });
    pg.y += ROW;
    pg.rule(pg.y);
  }
  pg.y += 9;
}

function panel(
  pg: Page,
  x: number,
  top: number,
  w: number,
  h: number,
  title: string,
) {
  pg.doc
    .roundedRect(x, top, w, h, 6)
    .lineWidth(0.75)
    .strokeColor(P.line)
    .stroke();
  pg.text(title, x + 12, top + 11, { size: 10, bold: true });
}

// Riga etichetta/valore dei pannelli del riepilogo.
function pair(
  pg: Page,
  x: number,
  w: number,
  y: number,
  label: string,
  value: string,
  style: TextStyle = {},
) {
  pg.text(label, x + 12, y + 3.5, {
    size: 8.5,
    color: P.ink2,
    ...style,
    width: w - 130,
  });
  pg.text(value, x + 12, y + 3.5, {
    size: 8.5,
    ...style,
    color: style.color === P.ink2 ? P.ink : style.color,
    width: w - 24,
    align: "right",
  });
}

function recap(pg: Page, report: Report) {
  const rowH = 14;
  const gap = 12;
  const w1 = Math.round((pg.width - gap) * 0.47);
  const w2 = pg.width - gap - w1;
  const [x1, x2] = [pg.left, pg.left + w1 + gap];
  const sales = report.summary.filter((m) => m.group === "vendite");
  const payRows = Math.max(report.payments.length, 1) + 1;
  const salesH = 32 + sales.length * rowH + 10;
  const paymentsH = 32 + 13 + payRows * rowH + 10;
  const cashH = 32 + 3 * rowH + 8 + 28 + 22;
  const h = Math.max(salesH, paymentsH + gap + cashH);
  section(pg, "Riepilogo giornaliero", "", h);
  const top = pg.y;

  // Colonna sinistra: voci di vendita nell'ordine del rapportino originale.
  panel(pg, x1, top, w1, h, "Vendite");
  let y = top + 32;
  sales.forEach((m, i) => {
    if (i) pg.rule(y, P.line, 0.5, x1 + 12, x1 + w1 - 12);
    pair(pg, x1, w1, y, m.label, displayMetric(m), {
      bold: m.strong,
      color: m.strong ? P.ink : P.ink2,
    });
    y += rowH;
  });

  // Colonna destra: pagamenti del giorno e cassa contanti.
  panel(pg, x2, top, w2, paymentsH, "Pagamenti del giorno");
  const amountW = 80;
  const methodW = w2 - 24 - 2 * amountW;
  const [xa, xb] = [x2 + 12 + methodW, x2 + 12 + methodW + amountW];
  const head = { size: 7.5, bold: true, color: P.muted };
  y = top + 32;
  pg.text("Metodo", x2 + 12, y, head);
  pg.text("Incassi", xa, y, { ...head, width: amountW, align: "right" });
  pg.text("Rimborsi", xb, y, { ...head, width: amountW, align: "right" });
  y += 12;
  pg.rule(y, P.lineStrong, 0.6, x2 + 12, x2 + w2 - 12);
  const payRow = (
    label: string,
    detail: string,
    receipts: string,
    refunds: string,
    bold = false,
  ) => {
    const w = pg.text(label, x2 + 12, y + 3.5, {
      size: 8.5,
      bold,
      width: methodW - 6,
    });
    if (detail && w < methodW - 40)
      pg.text(detail, x2 + 18 + w, y + 4.5, {
        size: 7,
        color: P.muted,
        width: methodW - w - 12,
      });
    for (const [value, x] of [
      [receipts, xa],
      [refunds, xb],
    ] as const)
      pg.text(value, x, y + 3.5, {
        size: 8.5,
        bold,
        color: value === DASH ? P.muted : P.ink,
        width: amountW,
        align: "right",
      });
    y += rowH;
  };
  if (!report.payments.length) {
    pg.text("Nessun movimento nel giorno", x2 + 12, y + 3.5, {
      size: 8.5,
      color: P.muted,
    });
    y += rowH;
  }
  for (const p of report.payments) {
    payRow(
      p.label,
      p.label.toLowerCase() === p.gateway ? "" : p.gateway,
      euro(p.receipts),
      p.refunds ? euro(p.refunds) : DASH,
    );
    pg.rule(y, P.line, 0.5, x2 + 12, x2 + w2 - 12);
  }
  pg.rule(y, P.lineStrong, 0.6, x2 + 12, x2 + w2 - 12);
  payRow(
    "Totale",
    "",
    euro(report.receiptsTotal),
    report.refundsTotal ? euro(report.refundsTotal) : DASH,
    true,
  );

  const cashTop = top + paymentsH + gap;
  panel(pg, x2, cashTop, w2, h - paymentsH - gap, "Cassa contanti");
  y = cashTop + 32;
  const cash: [string, number][] = [
    ["Contanti incassati", report.cashReceipts],
    ["Rimborsi contanti", -report.cashRefunds],
    ["Uscite di cassa", -report.expensesTotal],
  ];
  cash.forEach(([label, value], i) => {
    if (i) pg.rule(y, P.line, 0.5, x2 + 12, x2 + w2 - 12);
    pair(pg, x2, w2, y, label, euro(value));
    y += rowH;
  });
  y += 8;
  pg.box(x2 + 8, y, w2 - 16, 28, P.accentSoft, 5);
  pg.text("Contanti attesi", x2 + 16, y + 10, {
    size: 9,
    bold: true,
    color: P.accent,
  });
  pg.text(euro(report.cashExpected), x2 + 16, y + 7.5, {
    size: 13,
    bold: true,
    color: P.accent,
    width: w2 - 32,
    align: "right",
  });
  pg.text(
    "Senza fondo cassa iniziale, versamenti e trasferimenti.",
    x2 + 12,
    y + 35,
    { size: 7, color: P.muted, width: w2 - 24 },
  );
  pg.y = top + h + 18;
}

function expenses(pg: Page, report: Report) {
  if (!report.expenses.length) {
    section(pg, "Uscite di cassa", "", 24);
    pg.text("Nessuna uscita registrata per questa data.", pg.left, pg.y + 2, {
      size: 8.5,
      color: P.muted,
    });
    pg.y += 28;
    return;
  }
  const cols = columns(pg, [
    { label: "Ora", width: 50, align: "left" },
    { label: "Causale", width: 180, align: "left" },
    { label: "Note", width: 0, align: "left" },
    { label: "Operatore ID", width: 130, align: "left" },
    { label: "Importo", width: 90, align: "right" },
  ]);
  const heights = report.expenses.map((e) =>
    Math.max(
      ROW,
      pg.measure(e.reason, cols[1].width - 2 * PAD, { size: 9, bold: true }) +
        8,
      pg.measure(e.note, cols[2].width - 2 * PAD, { size: 9 }) + 8,
    ),
  );
  const block = 19 + heights.reduce((n, h) => n + h, 0) + ROW;
  section(
    pg,
    "Uscite di cassa",
    `${plural(report.expenses.length, "uscita", "uscite")}  ·  ${euro(report.expensesTotal)}`,
    block <= KEEP ? block : 19 + heights[0],
  );
  tableHead(pg, cols);
  report.expenses.forEach((e, i) => {
    pg.ensure(heights[i] + (i === heights.length - 1 ? ROW : 0), () =>
      tableHead(pg, cols),
    );
    const y = pg.y + 4;
    pg.text(timeOf(e.createdAt, report.timezone), cols[0].x + PAD, y, {
      size: 9,
    });
    pg.paragraph(e.reason, cols[1].x + PAD, y, cols[1].width - 2 * PAD, {
      size: 9,
      bold: true,
    });
    pg.paragraph(e.note, cols[2].x + PAD, y, cols[2].width - 2 * PAD, {
      size: 9,
      color: P.ink2,
    });
    pg.text(e.operatorId, cols[3].x + PAD, y, {
      size: 8.5,
      color: P.muted,
      width: cols[3].width - 2 * PAD,
    });
    pg.text(euro(e.amountCents), cols[4].x + PAD, y, {
      size: 9,
      bold: true,
      width: cols[4].width - 2 * PAD,
      align: "right",
    });
    pg.y += heights[i];
    pg.rule(pg.y);
  });
  pg.doc.rect(pg.left, pg.y, pg.width, ROW).fill(P.soft);
  pg.text("Totale uscite", cols[0].x + PAD, pg.y + 4, {
    size: 9,
    bold: true,
  });
  pg.text(euro(report.expensesTotal), cols[4].x + PAD, pg.y + 4, {
    size: 9,
    bold: true,
    width: cols[4].width - 2 * PAD,
    align: "right",
  });
  pg.y += ROW + 18;
}

function notes(pg: Page, report: Report) {
  const width = pg.width - 12;
  const heights = report.warnings.map(
    (w) => pg.measure(w, width, { size: 7.5 }) + 3,
  );
  const block = 21 + heights.reduce((n, h) => n + h, 0);
  pg.ensure(block <= KEEP ? block : 21 + (heights[0] ?? 0));
  pg.rule(pg.y);
  pg.y += 8;
  pg.text("Note di lettura", pg.left, pg.y, {
    size: 8,
    bold: true,
    color: P.muted,
  });
  pg.y += 13;
  report.warnings.forEach((w, i) => {
    pg.ensure(heights[i]);
    pg.text("•", pg.left + 1, pg.y, { size: 7.5, color: P.muted });
    pg.paragraph(w, pg.left + 12, pg.y, width, { size: 7.5, color: P.muted });
    pg.y += heights[i];
  });
}

function footers(pg: Page, report: Report) {
  const { doc } = pg;
  const range = doc.bufferedPageRange();
  const final = report.status === "definitivo";
  const label = `Rapportino del ${shortDate(report.date)}  ·  ${report.shopName}  ·  ${
    final ? statusLabel(report) : "Bozza, non valida come chiusura"
  }`;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    if (!final) watermark(doc);
    // Il piè di pagina sta nel margine: evita che PDFKit apra una pagina nuova.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN + 12;
    pg.rule(y - 5);
    pg.text(label, pg.left, y, {
      size: 7.5,
      color: P.muted,
      width: pg.width - 100,
    });
    pg.text(`Pagina ${i + 1} di ${range.count}`, pg.left, y, {
      size: 7.5,
      color: P.muted,
      width: pg.width,
      align: "right",
    });
    doc.page.margins.bottom = margin;
  }
}

// Scritta "BOZZA" in trasparenza al centro della pagina.
function watermark(doc: Doc) {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-24, { origin: [width / 2, height / 2] });
  doc.font("Helvetica-Bold").fontSize(130).fillColor(P.ink).fillOpacity(0.06);
  doc.text(
    "BOZZA",
    width / 2 - doc.widthOfString("BOZZA") / 2,
    height / 2 - 55,
    {
      lineBreak: false,
    },
  );
  doc.restore();
}

export async function pdf(report: Report): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: report.title,
      Author: report.shopName,
      Creator: "Rapportino Giornaliero",
    },
    // Definitivo: stampabile ma non modificabile (password proprietario casuale e non salvata).
    ...(report.status === "definitivo" && {
      pdfVersion: "1.7",
      ownerPassword: randomUUID(),
      permissions: {
        printing: "highResolution",
        modifying: false,
        copying: true,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
    }),
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const pg = new Page(doc);
  header(pg, report);
  kpis(pg, report);
  const items = report.orders.reduce((n, o) => n + o.items, 0);
  const cols = columns(pg, [
    { label: "Prodotto", width: 0, align: "left" },
    { label: "Q.tà", width: 40, align: "right" },
    { label: "Prezzo confronto", width: 84, align: "right" },
    { label: "Prezzo vendita", width: 78, align: "right" },
    { label: "Sconto €", width: 70, align: "right" },
    { label: "Sconto %", width: 58, align: "right" },
    { label: "Totale", width: 80, align: "right" },
  ]);
  section(
    pg,
    "Dettaglio vendite",
    `${plural(report.orders.length, "vendita", "vendite")}  ·  ${plural(items, "articolo", "articoli")}`,
    19 + BAND + ROW,
  );
  if (report.orders.length) tableHead(pg, cols);
  else {
    pg.text("Nessuna vendita nella data scelta.", pg.left, pg.y + 2, {
      size: 9,
      color: P.muted,
    });
    pg.y += 28;
  }
  for (const o of report.orders) order(pg, cols, o);
  pg.y += 10;
  recap(pg, report);
  expenses(pg, report);
  notes(pg, report);
  footers(pg, report);
  doc.end();
  return done;
}
