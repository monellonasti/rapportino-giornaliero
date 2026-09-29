import type { LoaderFunctionArgs } from "@remix-run/node";
import { apiAdmin, apiError } from "../api.server";
import { config } from "../shopify.server";
import { loadReport } from "../report.server";
import { excel, fileName, pdf } from "../export.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await apiAdmin(request);
  try {
    const params = new URL(request.url).searchParams;
    const format = params.get("format");
    if (format !== "xlsx" && format !== "pdf")
      return new Response("Formato non valido", { status: 400 });
    const report = await loadReport(
      admin,
      session.shop,
      params.get("date"),
      config.cashGateways,
    );
    const bytes = await (format === "xlsx" ? excel(report) : pdf(report));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName(report, format)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, "api/export");
  }
}
