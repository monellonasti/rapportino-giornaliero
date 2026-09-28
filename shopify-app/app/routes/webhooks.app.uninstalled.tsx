import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  return new Response(null, { status: 200 });
}
