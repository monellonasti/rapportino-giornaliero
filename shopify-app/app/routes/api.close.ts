import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { apiAdmin, apiError, logError } from "../api.server";
import { config } from "../shopify.server";
import { closeReport } from "../report.server";
import { setEmailStatus, type EmailStatus } from "../closures.server";
import { reportAttachments, sendReport } from "../mailer.server";
import type { Report } from "../report";

// Stampa definitiva: chiude il giorno e invia la copia al gestore.
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await apiAdmin(request, true);
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const operator = session.onlineAccessInfo?.associated_user.id;
  if (!operator)
    return new Response("Sessione operatore richiesta", { status: 403 });
  if (!config.smtp)
    return Response.json(
      {
        error:
          "Stampa definitiva non disponibile: configurare sul server l'email del gestore (SMTP).",
      },
      { status: 503 },
    );
  try {
    const body = z
      .object({
        date: z.string(),
        requestId: z.string().uuid(),
        resend: z.boolean().default(false),
      })
      .parse(await request.json());
    const closure = await closeReport(
      admin,
      session.shop,
      body.date,
      String(operator),
      body.requestId,
      config.cashGateways,
    );
    let emailStatus = closure.emailStatus;
    // Email solo alla chiusura; dopo, solo se richiesto e non già confermato.
    if (closure.created || (body.resend && emailStatus !== "sent"))
      emailStatus = await notifyManager(session.shop, closure.report);
    return Response.json(
      { created: closure.created, emailStatus },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error, "api/close");
  }
}

async function notifyManager(shop: string, report: Report) {
  const attachments = await reportAttachments(report);
  let status: EmailStatus = "sent";
  try {
    await sendReport(report, attachments, config.smtp!.manager);
  } catch (error) {
    // Il server SMTP potrebbe averla accettata comunque: va verificata la casella.
    logError("api/close email", error);
    status = "uncertain";
  }
  await setEmailStatus(shop, report.date, status);
  return status;
}
