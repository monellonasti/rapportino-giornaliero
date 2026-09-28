import fs from "node:fs";
import "dotenv/config";
import assert from "node:assert/strict";
import TOML from "@iarna/toml";
const config = TOML.parse(fs.readFileSync("shopify.app.toml", "utf8"));
assert.equal(config.embedded, true);
assert.equal(config.access_scopes.use_legacy_install_flow, false);
for (const scope of ["read_orders", "read_products", "read_locations"])
  assert(
    config.access_scopes.scopes.split(",").includes(scope),
    `Scope mancante: ${scope}`,
  );
assert.equal(config.webhooks.api_version, "2026-07");
assert(
  config.auth.redirect_urls.includes(`${config.application_url}/auth/callback`),
);
assert(
  config.webhooks.subscriptions.some((s) =>
    s.topics.includes("app/uninstalled"),
  ),
);
assert(
  config.webhooks.subscriptions.some((s) =>
    s.topics.includes("app/scopes_update"),
  ),
);
if (process.argv.includes("--production")) {
  assert(
    !JSON.stringify(config).includes("replace"),
    "Sostituire client_id e dominio prima del deploy",
  );
  assert.match(config.application_url, /^https:\/\//);
  assert.equal(
    config.build.automatically_update_urls_on_dev,
    false,
    "In produzione disattivare la riscrittura degli URL dev",
  );
  if (process.env.SHOPIFY_API_KEY)
    assert.equal(config.client_id, process.env.SHOPIFY_API_KEY);
  if (process.env.SHOPIFY_APP_URL)
    assert.equal(
      config.application_url,
      process.env.SHOPIFY_APP_URL.replace(/\/$/, ""),
    );
}
console.log(
  "Configurazione TOML coerente" +
    (String(config.client_id).includes("replace")
      ? " (template: sostituire i placeholder prima dell'uso)"
      : ""),
);
