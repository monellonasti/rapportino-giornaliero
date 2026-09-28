import { requireAdmin, config } from "./shopify.server";
import { UserError } from "./errors";
export async function apiAdmin(request: Request, mutation = false) {
  // API chiamate solo da App Bridge: non accettare cookie o shop passati dal browser come autorizzazione.
  if (!request.headers.get("Authorization")?.startsWith("Bearer "))
    throw new Response("Autenticazione richiesta", { status: 401 });
  if (mutation && request.headers.get("Origin") !== config.appUrl)
    throw new Response("Origine non valida", { status: 403 });
  return requireAdmin(request);
}
export function apiError(error: unknown) {
  if (error instanceof Response) throw error;
  if (error instanceof UserError)
    return Response.json(
      { error: error.message },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  // Non esporre errori DB, segreti o payload Shopify al browser.
  return Response.json(
    {
      error:
        "Operazione non riuscita. Verifica data, importi, configurazione e disponibilità dei servizi.",
    },
    { status: 422, headers: { "Cache-Control": "no-store" } },
  );
}
