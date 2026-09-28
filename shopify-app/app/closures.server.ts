import type { Prisma } from "@prisma/client";
import db from "./db.server";
import type { Report } from "./report";

type Client = Prisma.TransactionClient;
export type EmailStatus = "pending" | "sent" | "uncertain";
export interface Closure {
  report: Report;
  emailStatus: EmailStatus;
}

// Serializza chiusura e nuove uscite dello stesso giorno (lock valido fino al commit).
export async function lockDay(tx: Client, shop: string, date: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${shop}|${date}`}))`;
}

export async function findClosure(
  shop: string,
  date: string,
  client: Client = db,
): Promise<Closure | null> {
  const row = await client.reportClosure.findUnique({
    where: { shop_reportDate: { shop, reportDate: date } },
  });
  return row
    ? {
        report: row.report as unknown as Report,
        emailStatus: row.emailStatus as EmailStatus,
      }
    : null;
}

export async function emailStatusOf(shop: string, date: string) {
  const row = await db.reportClosure.findUnique({
    where: { shop_reportDate: { shop, reportDate: date } },
    select: { emailStatus: true },
  });
  return (row?.emailStatus as EmailStatus | undefined) ?? null;
}

export async function isClosed(
  shop: string,
  date: string,
  client: Client = db,
) {
  return !!(await client.reportClosure.findUnique({
    where: { shop_reportDate: { shop, reportDate: date } },
    select: { id: true },
  }));
}

export async function saveClosure(
  tx: Client,
  report: Report,
  shop: string,
  requestId: string,
) {
  await tx.reportClosure.create({
    data: {
      shop,
      reportDate: report.date,
      report: report as unknown as Prisma.InputJsonValue,
      operatorId: report.closedBy!,
      requestId,
    },
  });
}

export async function setEmailStatus(
  shop: string,
  date: string,
  emailStatus: EmailStatus,
) {
  await db.reportClosure.update({
    where: { shop_reportDate: { shop, reportDate: date } },
    data: { emailStatus },
  });
}
