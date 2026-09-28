import { displayMetric, statusLabel, type Report } from "./report";

export { excel } from "./export/excel.server";
export { pdf } from "./export/pdf.server";

export const fileName = (report: Report, extension: "xlsx" | "pdf") =>
  `Rapportino_${report.date}_${report.status}.${extension}`;

export const emailSubject = (report: Report) =>
  `${report.title} – ${report.status === "definitivo" ? "DEFINITIVO" : "BOZZA"} – ${report.shopName}`;

// Corpo dell'email: i numeri principali leggibili senza aprire gli allegati.
export function emailText(report: Report) {
  return [
    `${report.title} – ${report.shopName}`,
    statusLabel(report) +
      (report.closedBy ? ` (operatore ${report.closedBy})` : ""),
    "",
    ...report.kpis.map((k) => `${k.label}: ${displayMetric(k)} (${k.hint})`),
    "",
    "In allegato il rapportino completo (Excel e PDF). Prima di usare i totali per la chiusura, consultare le note e i limiti inclusi negli allegati.",
  ].join("\n");
}
