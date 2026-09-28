import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { apiAdmin, apiError } from "../api.server";
import { config } from "../shopify.server";
import db from "../db.server";
import { loadReport } from "../report.server";
import { reportAttachments, sendReport } from "../mailer.server";
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await apiAdmin(request, true);
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!config.smtp)
    return Response.json(
      { error: "Email disabilitata: configurare SMTP sul server." },
      { status: 503 },
    );
  let deliveryId: string | undefined;
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
    const attachments = await reportAttachments(report);
    const existing = await db.emailDelivery.findUnique({
      where: {
        shop_requestId: { shop: session.shop, requestId: body.requestId },
      },
    });
    if (existing)
      return Response.json(
        {
          error: `Richiesta già registrata (${existing.status}). Verificare la casella prima di riprovare.`,
        },
        { status: 409 },
      );
    deliveryId = (
      await db.emailDelivery.create({
        data: { shop: session.shop, requestId: body.requestId },
      })
    ).id;
    await sendReport(report, attachments, config.smtp.to);
    await db.emailDelivery.update({
      where: { id: deliveryId },
      data: { status: "sent" },
    });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (deliveryId)
      await db.emailDelivery
        .update({ where: { id: deliveryId }, data: { status: "uncertain" } })
        .catch(() => {});
    return apiError(error);
  }
}
