import nodemailer from "nodemailer";
import { config } from "./shopify.server";
import { emailSubject, emailText, excel, fileName, pdf } from "./export.server";
import type { Report } from "./report";

// Allegati generati prima di registrare l'invio: un errore qui non lascia esiti ambigui.
export async function reportAttachments(report: Report) {
  return [
    { filename: fileName(report, "xlsx"), content: await excel(report) },
    { filename: fileName(report, "pdf"), content: await pdf(report) },
  ];
}

export async function sendReport(
  report: Report,
  attachments: Awaited<ReturnType<typeof reportAttachments>>,
  to: string,
) {
  const smtp = config.smtp;
  if (!smtp) throw new Error("SMTP non configurato");
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 15000,
    socketTimeout: 30000,
  });
  await transport.sendMail({
    from: smtp.from,
    to,
    subject: emailSubject(report),
    text: emailText(report),
    attachments,
  });
}
