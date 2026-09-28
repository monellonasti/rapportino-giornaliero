import "dotenv/config";
import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { readConfig } from "./config.server";

export const config = readConfig(process.env);
const shopify = shopifyApp({
  apiKey: config.apiKey,
  apiSecretKey: config.apiSecret,
  apiVersion: ApiVersion.July26,
  scopes: config.scopes,
  appUrl: config.appUrl,
  authPathPrefix: "/auth",
  isEmbeddedApp: true,
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.SingleMerchant,
  useOnlineTokens: true,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
});
export default shopify;
export const { authenticate, login, addDocumentResponseHeaders } = shopify;
export async function requireAdmin(request: Request) {
  const context = await authenticate.admin(request);
  if (!config.allowedShops.includes(context.session.shop))
    throw new Response("Store non autorizzato", { status: 403 });
  return context;
}
