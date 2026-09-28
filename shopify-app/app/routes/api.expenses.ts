import type { ActionFunctionArgs } from "@remix-run/node";
import { apiAdmin, apiError } from "../api.server";
import { addExpense } from "../expenses.server";
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await apiAdmin(request, true);
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const user = session.onlineAccessInfo?.associated_user.id;
  if (!user)
    return new Response("Sessione operatore richiesta", { status: 403 });
  try {
    await addExpense(session.shop, String(user), await request.formData());
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
