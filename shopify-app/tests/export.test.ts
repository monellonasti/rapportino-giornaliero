import { it, expect } from "vitest";
import ExcelJS from "exceljs";
import { emailSubject, emailText, excel, pdf } from "../app/export.server";
import { asDefinitive, makeReport, type Order } from "../app/report";
it("segna bozza e definitivo e protegge solo i file definitivi", async () => {
  const draft = makeReport({
    date: "2026-09-27",
    shopName: "Test",
    timezone: "Europe/Rome",
    currency: "EUR",
    sales: [],
    movements: [],
    expenses: [],
    cashGateways: ["cash"],
  });
  const final = asDefinitive(draft, "42", new Date("2026-09-27T20:15:00Z"));
  const load = async (bytes: Buffer) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    return book;
  };
  // ExcelJS legge la protezione del foglio ma non la dichiara nei tipi.
  const locked = (ws: ExcelJS.Worksheet) =>
    !!(ws as unknown as { sheetProtection?: { sheet?: boolean } })
      .sheetProtection?.sheet;
  const draftBook = await load(await excel(draft));
  const finalBook = await load(await excel(final));
  expect(draftBook.getWorksheet("Rapportino")!.getCell("G1").value).toBe(
    "BOZZA",
  );
  expect(finalBook.getWorksheet("Rapportino")!.getCell("G1").value).toBe(
    "DEFINITIVO",
  );
  expect(draftBook.worksheets.some(locked)).toBe(false);
  expect(finalBook.worksheets.every(locked)).toBe(true);
  expect((await pdf(draft)).toString("latin1")).not.toContain("/Encrypt");
  expect((await pdf(final)).toString("latin1")).toContain("/Encrypt");
  expect(emailSubject(final)).toContain("DEFINITIVO");
  expect(emailText(final)).toContain(
    "Definitivo · chiuso il 27/09/2026 alle 22:15 (operatore 42)",
  );
});
it("crea Excel e PDF validi includendo le uscite senza interpretare formule nelle note", async () => {
  const report = makeReport({
    date: "2026-09-27",
    shopName: "Test",
    timezone: "Europe/Rome",
    currency: "EUR",
    sales: [],
    movements: [],
    cashGateways: ["cash"],
    expenses: [
      {
        id: "e",
        amountCents: 3500,
        reason: "Corriere",
        note: '=HYPERLINK("https://invalid.test")',
        operatorId: "123",
        createdAt: "2026-09-27T10:00:00Z",
      },
    ],
  });
  const xlsx = await excel(report);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(xlsx as never);
  expect(book.worksheets).toHaveLength(4);
  expect(book.getWorksheet("Uscite")!.getCell("E2").value).toBe(35);
  expect(book.getWorksheet("Uscite")!.getCell("C2").type).toBe(
    ExcelJS.ValueType.String,
  );
  const bytes = await pdf(report);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.toString("latin1")).toContain("%%EOF");
});
it("impagina su più pagine le giornate con molte vendite", async () => {
  const money = (amount: string) => ({
    shopMoney: { amount, currencyCode: "EUR" },
  });
  const sale = (n: number): Order => ({
    id: String(n),
    name: `#${n}`,
    createdAt: "2026-09-27T10:00:00Z",
    sourceName: "pos",
    cancelledAt: null,
    test: false,
    paymentGatewayNames: ["cash"],
    totalPriceSet: money("20"),
    totalTaxSet: money("3.61"),
    totalShippingPriceSet: money("0"),
    totalDiscountsSet: money("0"),
    lineItems: {
      nodes: [1, 2].map((i) => ({
        name: `Articolo ${i} con una descrizione abbastanza lunga da andare a capo nella tabella`,
        quantity: 1,
        originalUnitPriceSet: money("10"),
        discountedTotalSet: money("10"),
        variant: { compareAtPrice: "12" },
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    transactions: [],
  });
  const report = makeReport({
    date: "2026-09-27",
    shopName: "Bar & Co",
    timezone: "Europe/Rome",
    currency: "EUR",
    sales: Array.from({ length: 40 }, (_, i) => sale(i + 1)),
    movements: [],
    expenses: [],
    cashGateways: ["cash"],
  });
  const pages = (await pdf(report))
    .toString("latin1")
    .match(/\/Type \/Page\b/g);
  expect(pages!.length).toBeGreaterThan(2);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await excel(report)) as never);
  const sheet = book.getWorksheet("Rapportino")!;
  expect(sheet.getCell("A1").value).toBe(
    "Rapportino della domenica 27 settembre 2026",
  );
  expect(sheet.headerFooter.oddFooter).toContain("Bar && Co");
  expect(emailText(report)).toContain(
    "Numero vendite: 40 (80 articoli venduti)",
  );
});
