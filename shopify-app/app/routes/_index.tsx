import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(
    url.searchParams.has("shop") ? `/app${url.search}` : "/auth/login",
  );
}
