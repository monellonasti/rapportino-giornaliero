import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  loadReport: vi.fn(),
  sendReport: vi.fn(),
  reportAttachments: vi.fn(),
  db: {
    emailDelivery: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("../app/shopify.server", () => ({
  config: {
    appUrl: "https://rapportino.test",
    cashGateways: ["cash"],
    smtp: { to: "titolare@negozio.test", manager: "gestore@negozio.test" },
  },
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../app/report.server", () => ({ loadReport: mocks.loadReport }));
vi.mock("../app/mailer.server", () => ({
  sendReport: mocks.sendReport,
  reportAttachments: mocks.reportAttachments,
}));
vi.mock("../app/db.server", () => ({ default: mocks.db }));
import { action } from "../app/routes/api.email";

const shop = "verified.myshopify.com";
const send = (requestId = randomUUID()) =>
  action({
    request: new Request("https://rapportino.test/api/email", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        Origin: "https://rapportino.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ date: "2026-09-27", requestId }),
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.requireAdmin.mockResolvedValue({ admin: {}, session: { shop } });
  mocks.loadReport.mockResolvedValue({ date: "2026-09-27", status: "bozza" });
  mocks.reportAttachments.mockResolvedValue([]);
  mocks.sendReport.mockResolvedValue(undefined);
  mocks.db.emailDelivery.findUnique.mockResolvedValue(null);
  mocks.db.emailDelivery.create.mockResolvedValue({ id: "d1" });
  mocks.db.emailDelivery.update.mockResolvedValue({});
});

it("invia al destinatario configurato e registra l'esito", async () => {
  const response = await send();
  expect(response.status).toBe(200);
  expect(mocks.sendReport).toHaveBeenCalledWith(
    expect.anything(),
    [],
    "titolare@negozio.test",
  );
  expect(mocks.db.emailDelivery.update).toHaveBeenCalledWith({
    where: { id: "d1" },
    data: { status: "sent" },
  });
});

it("se il server di posta non conferma, lo dice chiaramente e registra l'esito incerto", async () => {
  mocks.sendReport.mockRejectedValue(new Error("SMTP timeout"));
  const response = await send();
  expect(response.status).toBe(502);
  expect((await response.json()).error).toMatch(/non ha confermato/);
  expect(mocks.db.emailDelivery.update).toHaveBeenCalledWith({
    where: { id: "d1" },
    data: { status: "uncertain" },
  });
  expect(console.error).toHaveBeenCalled();
});

it("se l'esito non si salva, l'email già accettata non risulta fallita", async () => {
  mocks.db.emailDelivery.update.mockRejectedValue(new Error("db down"));
  expect((await send()).status).toBe(200);
  expect(console.error).toHaveBeenCalled();
});

it("la stessa richiesta non parte due volte", async () => {
  mocks.db.emailDelivery.findUnique.mockResolvedValue({ status: "sent" });
  const response = await send();
  expect(response.status).toBe(409);
  expect(mocks.sendReport).not.toHaveBeenCalled();
});
