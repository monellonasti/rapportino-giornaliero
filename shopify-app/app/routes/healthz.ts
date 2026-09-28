import db from "../db.server";
export async function loader() {
  try {
    await db.$queryRaw`SELECT 1`;
    return new Response("ok", { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("unavailable", { status: 503 });
  }
}
