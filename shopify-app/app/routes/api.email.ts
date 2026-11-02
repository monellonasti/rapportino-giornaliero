import type { ActionFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiAdmin, apiError, logError } from "../api.server";
import { UserError } from "../errors";
import { config } from "../shopify.server";
import db from "../db.server";
import { loadReport } from "../report.server";
import { reportAttachments, sendReport } from "../mailer.server";
const noStore = { "Cache-Control": "no-store" };
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await apiAdmin(request, true);
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const smtp = config.smtp;
  if (!smtp)
    return Response.json(
      { error: "Email disabilitata: configurare SMTP sul server." },
      { status: 503 },
    );
  let prepared;
  try {
    const body = z
      .object({ date: z.string(), requestId: z.string().uuid() })
      .parse(await request.json());
    const report = await loadReport(
      admin,
      session.shop,
      body.date,
      config.cashGateways,
    );
    // Allegati generati prima di registrare l'invio: un errore qui non lascia esiti ambigui.
    const attachments = await reportAttachments(report);
    const existing = await db.emailDelivery.findUnique({
      where: {
        shop_requestId: { shop: session.shop, requestId: body.requestId },
      },
    });
    if (existing)
      throw new UserError(
        `Richiesta già registrata (${existing.status}). Verificare la casella prima di riprovare.`,
      );
    const delivery = await db.emailDelivery
      .create({ data: { shop: session.shop, requestId: body.requestId } })
      .catch((error: unknown) => {
        // Stessa richiesta arrivata due volte in parallelo: una sola viene inviata.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new UserError(
            "Richiesta già in corso. Verificare la casella prima di riprovare.",
          );
        throw error;
      });
    prepared = { report, attachments, deliveryId: delivery.id };
  } catch (error) {
    return apiError(error, "api/email");
  }
  try {
    await sendReport(prepared.report, prepared.attachments, smtp.to);
  } catch (error) {
    // Il server SMTP potrebbe averla accettata comunque: non va ripetuta alla cieca.
    logError("api/email smtp", error);
    await db.emailDelivery
      .update({
        where: { id: prepared.deliveryId },
        data: { status: "uncertain" },
      })
      .catch((e: unknown) => logError("api/email stato", e));
    return Response.json(
      {
        error:
          "Il server di posta non ha confermato l'invio: controlla la casella del destinatario prima di riprovare.",
      },
      { status: 502, headers: noStore },
    );
  }
  // Email già accettata: un errore nel salvare l'esito non deve farla sembrare fallita.
  await db.emailDelivery
    .update({ where: { id: prepared.deliveryId }, data: { status: "sent" } })
    .catch((e: unknown) => logError("api/email stato", e));
  return Response.json({ ok: true }, { headers: noStore });
}
