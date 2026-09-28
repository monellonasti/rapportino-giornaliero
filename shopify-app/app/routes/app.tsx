import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { config, requireAdmin } from "../shopify.server";
import styles from "../style.css?url";
export const links = () => [{ rel: "stylesheet", href: styles }];
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return { apiKey: config.apiKey };
}
export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => {
  const h = new Headers(boundary.headers(args));
  h.set("Cache-Control", "no-store");
  return h;
};
