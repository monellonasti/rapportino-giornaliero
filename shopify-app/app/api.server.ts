import { GraphqlQueryError } from "@shopify/shopify-api";
import { ZodError } from "zod";
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
// Errori inattesi: il dettaglio va solo nei log del server, mai al browser.
export function logError(scope: string, error: unknown) {
  const shopify =
    error instanceof GraphqlQueryError
      ? JSON.stringify(
          (error.body as { errors?: { graphQLErrors?: unknown } } | undefined)
            ?.errors?.graphQLErrors ?? null,
        )
      : "";
  console.error(
    `[${scope}]`,
    error instanceof Error ? (error.stack ?? error.message) : error,
    shopify,
  );
}
const noStore = { "Cache-Control": "no-store" };
export function apiError(error: unknown, scope = "api") {
  if (error instanceof Response) throw error;
  if (error instanceof UserError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: noStore },
    );
  if (error instanceof ZodError)
    return Response.json(
      { error: "Richiesta non valida: ricarica la pagina e riprova." },
      { status: 422, headers: noStore },
    );
  // Non esporre errori DB, segreti o payload Shopify al browser.
  logError(scope, error);
  return Response.json(
    {
      error:
        "Operazione non riuscita. Verifica data, importi, configurazione e disponibilità dei servizi.",
    },
    { status: 500, headers: noStore },
  );
}
