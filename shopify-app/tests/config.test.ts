import { it, expect } from "vitest";
import { readConfig } from "../app/config.server";
const env = {
  SHOPIFY_API_KEY: "testkey",
  SHOPIFY_API_SECRET: "testsecret",
  SHOPIFY_APP_URL: "https://rapportino.test",
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  ALLOWED_SHOPS: "test.myshopify.com",
};
it("non accetta segreti mancanti", () => {
  expect(() => readConfig({ ...env, SHOPIFY_API_SECRET: "" })).toThrow(
    /SHOPIFY_API_SECRET/,
  );
});
it("rifiuta HTTP e database temporanei", () => {
  expect(() =>
    readConfig({ ...env, SHOPIFY_APP_URL: "http://rapportino.test" }),
  ).toThrow();
  expect(() =>
    readConfig({ ...env, DATABASE_URL: "file:dev.sqlite" }),
  ).toThrow();
});
it("richiede tutti gli scope", () => {
  expect(() => readConfig({ ...env, SCOPES: "read_orders" })).toThrow();
  expect(readConfig(env).scopes).toHaveLength(3);
});
it("SMTP disabilitato per default, credenziali richieste se abilitato", () => {
  expect(readConfig(env).emailEnabled).toBe(false);
  expect(() => readConfig({ ...env, EMAIL_ENABLED: "true" })).toThrow();
});
it("il gestore riceve la stampa definitiva, di default su EMAIL_TO", () => {
  const smtp = {
    ...env,
    EMAIL_ENABLED: "true",
    SMTP_HOST: "smtp.negozio.test",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASSWORD: "password",
    EMAIL_FROM: "rapportino@negozio.test",
    EMAIL_TO: "cassa@negozio.test",
  };
  expect(readConfig(smtp).smtp?.manager).toBe("cassa@negozio.test");
  expect(
    readConfig({ ...smtp, EMAIL_GESTORE: "gestore@negozio.test" }).smtp
      ?.manager,
  ).toBe("gestore@negozio.test");
  expect(() => readConfig({ ...smtp, EMAIL_GESTORE: "non-valida" })).toThrow();
});
