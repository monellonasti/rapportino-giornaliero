import { z } from "zod";

export const REQUIRED_SCOPES = [
  "read_orders",
  "read_products",
  "read_locations",
];
export function readConfig(env: Record<string, string | undefined>) {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value || /replace[_-]|example\.com/.test(value))
      throw new Error(`Configurare ${key}`);
    return value;
  };
  const appUrl = new URL(required("SHOPIFY_APP_URL"));
  if (
    appUrl.protocol !== "https:" ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  )
    throw new Error("SHOPIFY_APP_URL deve essere un'origine HTTPS");
  const databaseUrl = new URL(required("DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol))
    throw new Error("DATABASE_URL deve usare PostgreSQL");
  const scopes = (env.SCOPES || REQUIRED_SCOPES.join(","))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (REQUIRED_SCOPES.some((s) => !scopes.includes(s)))
    throw new Error("SCOPES: mancano permessi obbligatori");
  const allowedShops = required("ALLOWED_SHOPS")
    .split(",")
    .map((x) => x.trim().toLowerCase());
  if (allowedShops.some((s) => !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)))
    throw new Error("ALLOWED_SHOPS non valido");
  const flag = (key: string) => {
    const value = env[key] || "false";
    if (!["true", "false"].includes(value))
      throw new Error(`${key}: usare true o false`);
    return value === "true";
  };
  const emailEnabled = flag("EMAIL_ENABLED");
  let smtp;
  if (emailEnabled) {
    const port = Number(required("SMTP_PORT"));
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("SMTP_PORT non valida");
    smtp = {
      host: required("SMTP_HOST"),
      port,
      secure: flag("SMTP_SECURE"),
      user: required("SMTP_USER"),
      pass: required("SMTP_PASSWORD"),
      from: z.string().email().parse(required("EMAIL_FROM")),
      to: z.string().email().parse(required("EMAIL_TO")),
      // Destinatario della stampa definitiva; se assente coincide con EMAIL_TO.
      manager: z
        .string()
        .email()
        .parse(env.EMAIL_GESTORE?.trim() || required("EMAIL_TO")),
    };
  }
  return {
    apiKey: required("SHOPIFY_API_KEY"),
    apiSecret: required("SHOPIFY_API_SECRET"),
    appUrl: appUrl.origin,
    scopes,
    allowedShops,
    emailEnabled,
    smtp,
    cashGateways: (env.CASH_GATEWAYS || "cash,contanti")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  };
}
