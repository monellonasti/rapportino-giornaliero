import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  closeReport: vi.fn(),
  setEmailStatus: vi.fn(),
  sendReport: vi.fn(),
  reportAttachments: vi.fn(),
  config: {
    appUrl: "https://rapportino.test",
    cashGateways: ["cash"],
    smtp: { manager: "gestore@negozio.test" } as
      | { manager: string }
      | undefined,
  },
}));
vi.mock("../app/shopify.server", () => ({
  config: mocks.config,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../app/report.server", () => ({ closeReport: mocks.closeReport }));
vi.mock("../app/closures.server", () => ({
  setEmailStatus: mocks.setEmailStatus,
}));
vi.mock("../app/mailer.server", () => ({
  sendReport: mocks.sendReport,
  reportAttachments: mocks.reportAttachments,
}));
import { action } from "../app/routes/api.close";

const shop = "verified.myshopify.com";
const report = { date: "2026-09-27", status: "definitivo" };
const close = (body: Record<string, unknown> = {}) =>
  action({
    request: new Request("https://rapportino.test/api/close", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        Origin: "https://rapportino.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: "2026-09-27",
        requestId: randomUUID(),
        ...body,
      }),
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.smtp = { manager: "gestore@negozio.test" };
  mocks.reportAttachments.mockResolvedValue([]);
  mocks.requireAdmin.mockResolvedValue({
    admin: {},
    session: { shop, onlineAccessInfo: { associated_user: { id: 42 } } },
  });
});

it("alla chiusura invia il rapportino definitivo al gestore", async () => {
  mocks.closeReport.mockResolvedValue({
    report,
    emailStatus: "pending",
    created: true,
  });
  const response = await close();
  expect(await response.json()).toEqual({ created: true, emailStatus: "sent" });
  expect(mocks.closeReport.mock.calls[0][3]).toBe("42");
  expect(mocks.sendReport).toHaveBeenCalledWith(
    report,
    [],
    "gestore@negozio.test",
  );
  expect(mocks.setEmailStatus).toHaveBeenCalledWith(shop, report.date, "sent");
});

it("la ristampa di un giorno già chiuso non reinvia l'email", async () => {
  mocks.closeReport.mockResolvedValue({
    report,
    emailStatus: "sent",
    created: false,
  });
  expect(await (await close({ resend: true })).json()).toEqual({
    created: false,
    emailStatus: "sent",
  });
  expect(mocks.sendReport).not.toHaveBeenCalled();
});

it("reinvia su richiesta solo se l'invio non era confermato", async () => {
  mocks.closeReport.mockResolvedValue({
    report,
    emailStatus: "uncertain",
    created: false,
  });
  await close();
  expect(mocks.sendReport).not.toHaveBeenCalled();
  await close({ resend: true });
  expect(mocks.sendReport).toHaveBeenCalledOnce();
});

it("se l'SMTP fallisce il definitivo resta salvato con esito incerto", async () => {
  mocks.closeReport.mockResolvedValue({
    report,
    emailStatus: "pending",
    created: true,
  });
  mocks.sendReport.mockRejectedValue(new Error("smtp down"));
  expect(await (await close()).json()).toEqual({
    created: true,
    emailStatus: "uncertain",
  });
  expect(mocks.setEmailStatus).toHaveBeenCalledWith(
    shop,
    report.date,
    "uncertain",
  );
});

it("senza email del gestore o senza operatore non chiude il giorno", async () => {
  mocks.config.smtp = undefined;
  expect((await close()).status).toBe(503);
  mocks.config.smtp = { manager: "gestore@negozio.test" };
  mocks.requireAdmin.mockResolvedValue({ admin: {}, session: { shop } });
  expect((await close()).status).toBe(403);
  expect(mocks.closeReport).not.toHaveBeenCalled();
});
