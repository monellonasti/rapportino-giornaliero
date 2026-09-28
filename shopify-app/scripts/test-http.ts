import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
// Esegue le vere route del build in memoria, senza aprire porte o contattare Shopify.
if (!process.env.TEST_DATABASE_URL)
  throw new Error("Impostare TEST_DATABASE_URL su database migrato di test");
Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  SHOPIFY_API_KEY: "00000000000000000000000000000000",
  SHOPIFY_API_SECRET: "synthetic-test-secret-only",
  SHOPIFY_APP_URL: "https://rapportino.test",
  ALLOWED_SHOPS: "synthetic.myshopify.com",
  EMAIL_ENABLED: "false",
});
const { createRequestHandler } = await import("@remix-run/node");
const build = await import(
  pathToFileURL(path.resolve("build/server/index.js")).href
);
const handler = createRequestHandler(build, "production");
try {
  const health = await handler(new Request("https://rapportino.test/healthz"));
  assert.equal(health.status, 200);
  const root = await handler(new Request("https://rapportino.test/"));
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("Location"), "/auth/login");
  const login = await handler(
    new Request("https://rapportino.test/auth/login"),
  );
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Accedi con Shopify/);
  const download = await handler(
    new Request(
      "https://rapportino.test/api/export?date=2026-09-27&format=xlsx",
    ),
  );
  assert.equal(download.status, 401);
  const invalid = await handler(
    new Request("https://rapportino.test/api/expenses", {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid",
        Origin: "https://rapportino.test",
      },
    }),
  );
  assert.equal(invalid.status, 401);
  const webhook = await handler(
    new Request("https://rapportino.test/webhooks/app/uninstalled", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": "synthetic.myshopify.com",
        "X-Shopify-Topic": "app/uninstalled",
        "X-Shopify-Hmac-Sha256": "invalid",
      },
      body: "{}",
    }),
  );
  assert.ok([400, 401].includes(webhook.status));
  console.log(
    "PASS: built HTTP handlers health/login/redirect/API 401/invalid JWT/invalid webhook HMAC",
  );
} finally {
  await global.prismaGlobal?.$disconnect();
}
