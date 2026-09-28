import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdmin } from "../shopify.server";
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}
