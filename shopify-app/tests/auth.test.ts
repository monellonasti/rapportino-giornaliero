import { it, expect, vi, beforeEach } from "vitest";
const auth = vi.hoisted(() => ({ admin: vi.fn(), webhook: vi.fn() }));
const db = vi.hoisted(() => ({ session: { deleteMany: vi.fn() } }));
vi.mock("../app/shopify.server", () => ({
  config: { appUrl: "https://rapportino.test" },
  requireAdmin: auth.admin,
  authenticate: { webhook: auth.webhook },
}));
vi.mock("../app/db.server", () => ({ default: db }));
import { apiAdmin } from "../app/api.server";
import { action as uninstall } from "../app/routes/webhooks.app.uninstalled";
beforeEach(() => vi.clearAllMocks());
it("rifiuta API senza bearer prima di accedere ai dati", async () => {
  await expect(
    apiAdmin(
      new Request("https://rapportino.test/api/export?shop=evil.myshopify.com"),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(auth.admin).not.toHaveBeenCalled();
});
it("rifiuta mutazioni cross-origin", async () => {
  await expect(
    apiAdmin(
      new Request("https://rapportino.test/api/expenses", {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid",
          Origin: "https://evil.test",
        },
      }),
      true,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(auth.admin).not.toHaveBeenCalled();
});
it("delega la verifica del token a Shopify", async () => {
  auth.admin.mockRejectedValue(new Response(null, { status: 401 }));
  await expect(
    apiAdmin(
      new Request("https://rapportino.test/api/export", {
        headers: { Authorization: "Bearer invalid" },
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(auth.admin).toHaveBeenCalledOnce();
});
it("non cancella sessioni se la firma webhook non è valida", async () => {
  auth.webhook.mockRejectedValue(new Response(null, { status: 401 }));
  await expect(
    uninstall({
      request: new Request("https://rapportino.test/webhooks/app/uninstalled", {
        method: "POST",
      }),
    } as never),
  ).rejects.toMatchObject({ status: 401 });
  expect(db.session.deleteMany).not.toHaveBeenCalled();
});
it("disinstallazione elimina tutte le sessioni solo dello shop verificato anche senza sessione corrente", async () => {
  auth.webhook.mockResolvedValue({
    shop: "a.myshopify.com",
    session: undefined,
  });
  db.session.deleteMany.mockResolvedValue({ count: 2 });
  await uninstall({
    request: new Request("https://rapportino.test/webhooks/app/uninstalled", {
      method: "POST",
    }),
  } as never);
  expect(db.session.deleteMany).toHaveBeenCalledWith({
    where: { shop: "a.myshopify.com" },
  });
});
