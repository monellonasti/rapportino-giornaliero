import os
import time
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Optional
from zoneinfo import ZoneInfo

import requests

# Tentativi per errori temporanei: rete, limite di velocità (429 o THROTTLED) e server Shopify (5xx).
MAX_ATTEMPTS = 4
RETRY_STATUS = {429, 502, 503, 504}

# Campi di ogni riga ordine, usati sia nella lista ordini sia per le righe oltre le prime 100.
LINE_FIELDS = """
                      name
                      quantity
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                      discountedUnitPriceSet { shopMoney { amount currencyCode } }
                      variant {
                        id
                        compareAtPrice
                        price
                        sku
                        product { title }
                      }
"""

ORDER_LINES_QUERY = """
query OrderLines($id: ID!, $cursor: String) {
  order(id: $id) {
    lineItems(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges { node { __LINE_FIELDS__ } }
    }
  }
}
""".replace("__LINE_FIELDS__", LINE_FIELDS)


def _throttled(errors):
    return any((e.get("extensions") or {}).get("code") == "THROTTLED" for e in errors if isinstance(e, dict))


def _throttle_wait(payload):
    """Secondi necessari a Shopify per ricaricare i punti mancanti, tra 1 e 10."""
    cost = (payload.get("extensions") or {}).get("cost") or {}
    status = cost.get("throttleStatus") or {}
    missing = (cost.get("requestedQueryCost") or 0) - (status.get("currentlyAvailable") or 0)
    rate = status.get("restoreRate") or 50
    return min(10.0, max(1.0, missing / rate))


class ShopifyClient:
    """
    Client minimale per Shopify Admin GraphQL API.

    Supporta il nuovo flusso Dev Dashboard:
    - SHOPIFY_CLIENT_ID
    - SHOPIFY_CLIENT_SECRET
    - token ottenuto via client_credentials grant

    Mantiene anche supporto opzionale a SHOPIFY_ADMIN_TOKEN per vecchie app legacy.
    """

    def __init__(self, shop: Optional[str] = None, api_version: Optional[str] = None):
        self.shop = shop or os.getenv("SHOPIFY_SHOP") or os.getenv("SHOPIFY_STORE_DOMAIN")
        self.api_version = api_version or os.getenv("SHOPIFY_API_VERSION", "2026-07")

        self.legacy_token = os.getenv("SHOPIFY_ADMIN_TOKEN")
        self.client_id = os.getenv("SHOPIFY_CLIENT_ID")
        self.client_secret = os.getenv("SHOPIFY_CLIENT_SECRET")

        self._access_token: Optional[str] = None
        self._access_token_expires_at: float = 0

        if not self.shop:
            raise ValueError("SHOPIFY_SHOP / SHOPIFY_STORE_DOMAIN è obbligatorio")

        if not self.legacy_token and not (self.client_id and self.client_secret):
            raise ValueError(
                "Inserisci SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET. "
                "In alternativa, per vecchie custom app legacy, puoi usare SHOPIFY_ADMIN_TOKEN."
            )

        self.graphql_endpoint = f"https://{self.shop}/admin/api/{self.api_version}/graphql.json"
        self.token_endpoint = f"https://{self.shop}/admin/oauth/access_token"

    def _get_access_token(self) -> str:
        """Restituisce un access token valido per Admin API."""
        # Compatibilità con vecchie custom app create nello Shopify Admin.
        if self.legacy_token:
            return self.legacy_token

        # Se il token in memoria è ancora valido, lo riusiamo.
        if self._access_token and time.time() < self._access_token_expires_at - 120:
            return self._access_token

        response = requests.post(
            self.token_endpoint,
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )

        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RuntimeError(
                "Errore generando l'access token Shopify. "
                "Controlla shop domain, Client ID, Client Secret, installazione app e permessi. "
                f"Risposta Shopify: {response.text}"
            ) from exc

        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise RuntimeError(f"Shopify non ha restituito access_token: {payload}")

        expires_in = int(payload.get("expires_in", 86399))
        self._access_token = token
        self._access_token_expires_at = time.time() + expires_in
        return token

    def graphql(self, query, variables=None):
        """Esegue la query ritentando gli errori temporanei: rete, 429/5xx e limite di velocità (THROTTLED)."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            last = attempt == MAX_ATTEMPTS
            token = self._get_access_token()
            try:
                response = requests.post(
                    self.graphql_endpoint,
                    json={"query": query, "variables": variables or {}},
                    headers={
                        "X-Shopify-Access-Token": token,
                        "Content-Type": "application/json",
                    },
                    timeout=30,
                )
            except (requests.ConnectionError, requests.Timeout):
                if last:
                    raise
                time.sleep(2 * attempt)
                continue
            if response.status_code in RETRY_STATUS and not last:
                retry_after = response.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 2 * attempt)
                continue
            response.raise_for_status()
            payload = response.json()
            errors = payload.get("errors")
            if errors and not last and _throttled(errors):
                time.sleep(_throttle_wait(payload))
                continue
            if errors:
                raise RuntimeError(errors)
            return payload["data"]

    def get_shop_info(self):
        """Recupera nome negozio, fuso orario e dominio principale da Shopify."""
        query = """
        query ShopInfo {
          shop {
            name
            ianaTimezone
            currencyCode
            myshopifyDomain
            primaryDomain { host url }
          }
        }
        """
        data = self.graphql(query)
        return data.get("shop", {})

    def get_shop_display_name(self) -> str:
        """Nome da stampare sotto il titolo del rapportino.

        Priorità:
        1. nome negozio configurato su Shopify;
        2. host del dominio principale;
        3. dominio myshopify;
        4. SHOPIFY_SHOP.
        """
        info = self.get_shop_info()
        name = (info.get("name") or "").strip()
        if name:
            return name
        primary = info.get("primaryDomain") or {}
        host = (primary.get("host") or "").strip()
        if host:
            return host.replace("www.", "")
        myshopify = (info.get("myshopifyDomain") or "").strip()
        return myshopify or self.shop

    def get_orders_for_date(self, date_str, timezone="UTC"):
        # Giornata nel fuso orario del negozio, convertita in UTC per la ricerca Shopify.
        zone = ZoneInfo(timezone)
        day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=zone)
        start = day.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        end = (day + timedelta(days=1)).astimezone(dt_timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        search = f"created_at:>='{start}' created_at:<'{end}' status:any"

        query = """
        query OrdersForDate($cursor: String, $query: String!) {
          orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                name
                createdAt
                sourceName
                test
                cancelledAt
                displayFinancialStatus
                paymentGatewayNames
                subtotalPriceSet { shopMoney { amount currencyCode } }
                totalPriceSet { shopMoney { amount currencyCode } }
                totalDiscountsSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                totalShippingPriceSet { shopMoney { amount currencyCode } }
                lineItems(first: 100) {
                  pageInfo { hasNextPage endCursor }
                  edges {
                    node { __LINE_FIELDS__ }
                  }
                }
              }
            }
          }
        }
        """.replace("__LINE_FIELDS__", LINE_FIELDS)

        orders = []
        cursor = None
        while True:
            data = self.graphql(query, {"cursor": cursor, "query": search})
            connection = data["orders"]
            orders.extend(edge["node"] for edge in connection["edges"])
            if not connection["pageInfo"]["hasNextPage"]:
                break
            cursor = connection["pageInfo"]["endCursor"]
        for order in orders:
            self._complete_lines(order)
        return orders

    def _complete_lines(self, order):
        """Aggiunge le righe oltre le prime 100: un ordine troncato darebbe un dettaglio incompleto."""
        lines = order.get("lineItems") or {}
        info = lines.get("pageInfo") or {}
        while info.get("hasNextPage"):
            data = self.graphql(ORDER_LINES_QUERY, {"id": order["id"], "cursor": info["endCursor"]})
            page = data["order"]["lineItems"]
            if page["pageInfo"].get("hasNextPage") and page["pageInfo"].get("endCursor") == info["endCursor"]:
                raise RuntimeError(f"Paginazione righe interrotta per l'ordine {order.get('name')}")
            lines["edges"].extend(page["edges"])
            info = page["pageInfo"]
