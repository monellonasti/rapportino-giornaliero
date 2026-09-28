import { Form, useActionData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { login } from "../shopify.server";
export async function loader({ request }: LoaderFunctionArgs) {
  return await login(request);
}
export async function action({ request }: ActionFunctionArgs) {
  return await login(request);
}
export default function Login() {
  const data = useActionData<typeof action>();
  return (
    <main>
      <h1>Rapportino Giornaliero</h1>
      <Form method="post">
        <label>
          Dominio Shopify{" "}
          <input name="shop" placeholder="negozio.myshopify.com" required />
        </label>
        <button>Accedi con Shopify</button>
        {data?.shop && <p>Verifica il dominio del negozio.</p>}
      </Form>
    </main>
  );
}
