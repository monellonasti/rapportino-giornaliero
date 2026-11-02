import type { ActionFunctionArgs } from "@remix-run/node";
import { apiAdmin, apiError } from "../api.server";
import { cancelExpense } from "../expenses.server";
// Annulla un'uscita del giorno ancora aperto; l'operatore viene registrato.
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await apiAdmin(request, true);
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const user = session.onlineAccessInfo?.associated_user.id;
  if (!user)
    return new Response("Sessione operatore richiesta", { status: 403 });
  try {
    // JSON non valido: lo segnala la validazione (422), non un errore interno.
    const body = await request.json().catch(() => null);
    await cancelExpense(session.shop, String(user), body);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error, "api/expense-cancel");
  }
}
