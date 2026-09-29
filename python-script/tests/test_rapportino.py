"""Test dello script: calcolo del rapportino, chiamate a Shopify e stampa definitiva.

Avvio dalla cartella python-script:  python -m unittest discover -s tests -v
Nessuna chiamata reale: Shopify, email e stampante sono sostituiti da oggetti finti.
"""
import os
import stat
import sys
import tempfile
import unittest
from argparse import Namespace
from decimal import Decimal
from pathlib import Path
from unittest import mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
import shopify_client  # noqa: E402
from chiusura import Registry, sha256  # noqa: E402
from report_generator import build_report  # noqa: E402


def money(amount):
    return {'shopMoney': {'amount': amount, 'currencyCode': 'EUR'}}


def line(name, sold, original=None, qty=1, compare=None):
    return {'node': {
        'name': name, 'quantity': qty,
        'originalUnitPriceSet': money(original or sold), 'discountedUnitPriceSet': money(sold),
        'variant': {'compareAtPrice': compare},
    }}


def order(lines, subtotal, gateways=('cash',), name='#1001'):
    return {
        'id': 'gid://shopify/Order/1', 'name': name, 'createdAt': '2026-09-26T08:12:00Z',
        'sourceName': 'pos', 'test': False, 'cancelledAt': None,
        'paymentGatewayNames': list(gateways),
        'subtotalPriceSet': money(subtotal), 'totalPriceSet': money(subtotal),
        'totalDiscountsSet': money('0.00'), 'totalTaxSet': money('0.00'),
        'totalShippingPriceSet': money('0.00'),
        'lineItems': {'edges': lines},
    }


class CalcoloTest(unittest.TestCase):
    def test_omaggio_resta_a_zero_e_non_inventa_uno_sconto_ordine(self):
        sale = build_report([order([line('Candela', '20.00'), line('Omaggio', '0.00', original='10.00')], '20.00')],
                            '2026-09-26', 'Bottega Demo', 'Europe/Rome').sales[0]
        self.assertEqual(sale.lines[1].sold, Decimal('0.00'))
        self.assertEqual(sale.lines[1].total, Decimal('0.00'))
        self.assertEqual(sale.order_discount, Decimal('0.00'))
        self.assertEqual(sale.merchandise, Decimal('20.00'))

    def test_ora_locale_e_sconto_sull_ordine_nel_totale_merce(self):
        sale = build_report([order([line('Set tazze', '36.00', compare='48.00'),
                                    line('Tovagliette', '19.50', compare='26.00')], '50.00', ('shopify_payments',))],
                            '2026-09-26', 'Bottega Demo', 'Europe/Rome').sales[0]
        self.assertEqual(sale.time, '10:12')
        self.assertEqual(sale.order_discount, Decimal('5.50'))
        self.assertEqual(sale.discount, Decimal('24.00'))
        self.assertEqual(sale.payment, 'Carta')


class FakeResponse:
    def __init__(self, status=200, payload=None, headers=None):
        self.status_code = status
        self.payload = payload or {}
        self.headers = headers or {}

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


THROTTLED = {
    'errors': [{'message': 'Throttled', 'extensions': {'code': 'THROTTLED'}}],
    'extensions': {'cost': {'requestedQueryCost': 300, 'throttleStatus': {'currentlyAvailable': 100, 'restoreRate': 50}}},
}


@mock.patch.dict(os.environ, {'SHOPIFY_ADMIN_TOKEN': 'token-di-test'})
class ClientTest(unittest.TestCase):
    def client(self, responses):
        post = mock.Mock(side_effect=responses)
        patches = [mock.patch.object(shopify_client.requests, 'post', post),
                   mock.patch.object(shopify_client.time, 'sleep')]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return shopify_client.ShopifyClient(shop='bottega-demo.myshopify.com'), post

    def test_limite_di_velocita_attende_i_punti_mancanti_e_riprova(self):
        client, post = self.client([FakeResponse(payload=THROTTLED), FakeResponse(payload={'data': {'ok': True}})])
        self.assertEqual(client.graphql('{ shop { name } }'), {'ok': True})
        self.assertEqual(post.call_count, 2)
        shopify_client.time.sleep.assert_called_once_with(4.0)

    def test_errori_temporanei_del_server_vengono_ritentati(self):
        client, post = self.client([FakeResponse(503), requests.ConnectionError('rete'),
                                    FakeResponse(payload={'data': {'ok': True}})])
        self.assertEqual(client.graphql('{ shop { name } }'), {'ok': True})
        self.assertEqual(post.call_count, 3)

    def test_gli_altri_errori_non_vengono_ritentati(self):
        client, post = self.client([FakeResponse(payload={'errors': [{'message': 'Access denied'}]})])
        with self.assertRaises(RuntimeError):
            client.graphql('{ shop { name } }')
        self.assertEqual(post.call_count, 1)

    def test_dopo_troppi_tentativi_rinuncia(self):
        client, post = self.client([FakeResponse(payload=THROTTLED)] * 4)
        with self.assertRaises(RuntimeError):
            client.graphql('{ shop { name } }')
        self.assertEqual(post.call_count, 4)

    def test_ordini_con_piu_di_100_righe_vengono_letti_per_intero(self):
        client, _ = self.client([])
        first = order([line('Riga 1', '1.00')], '2.00')
        first['lineItems']['pageInfo'] = {'hasNextPage': True, 'endCursor': 'c1'}
        pages = [
            {'orders': {'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'edges': [{'node': first}]}},
            {'order': {'lineItems': {'pageInfo': {'hasNextPage': False, 'endCursor': None},
                                     'edges': [line('Riga 2', '1.00')]}}},
        ]
        calls = []
        client.graphql = lambda query, variables=None: calls.append(variables) or pages.pop(0)
        orders = client.get_orders_for_date('2026-09-26', 'Europe/Rome')
        self.assertEqual([e['node']['name'] for e in orders[0]['lineItems']['edges']], ['Riga 1', 'Riga 2'])
        self.assertEqual(calls[1], {'id': 'gid://shopify/Order/1', 'cursor': 'c1'})


class FakeClient:
    def get_shop_display_name(self):
        return 'Bottega Demo'

    def get_shop_info(self):
        return {'ianaTimezone': 'Europe/Rome'}

    def get_orders_for_date(self, date, timezone):
        return [order([line('Candela', '19.90', compare='24.90')], '19.90')]


ENV = {'SMTP_HOST': 'smtp.test', 'SMTP_USER': 'u', 'SMTP_PASSWORD': 'p',
       'EMAIL_FROM': 'cassa@negozio.test', 'EMAIL_GESTORE': 'gestore@negozio.test'}


class StampaDefinitivaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.cleanup)
        self.output = Path(self.tmp.name)
        self.sent, self.printed = [], []

    def cleanup(self):
        # I definitivi sono in sola lettura: vanno resi scrivibili per cancellarli.
        for path in self.output.rglob('*'):
            os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
        self.tmp.cleanup()

    def run_cli(self, stampa, send=None):
        return main.run(Namespace(date='2026-09-26', shop_name=None, stampa=stampa), FakeClient(), env=ENV,
                        send=send or (lambda settings, path, subject, body: self.sent.append((settings.manager, path))),
                        printer=self.printed.append, output=self.output, user='cassa')

    def test_chiude_registra_invia_e_stampa_una_volta_sola(self):
        path = self.run_cli('definitiva')
        entry = Registry(self.output / 'definitivi').get('2026-09-26')
        self.assertEqual(entry['sha256'], sha256(path))
        self.assertEqual(entry['email'], 'inviata')
        self.assertEqual(self.sent, [('gestore@negozio.test', path)])
        self.assertEqual(self.printed, [path])
        # Ristampa: stesso file, nessuna nuova email.
        self.assertEqual(self.run_cli('definitiva'), path)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.printed), 2)
        with self.assertRaises(main.Refused):
            self.run_cli('bozza')

    def test_file_definitivo_modificato_non_viene_ristampato(self):
        path = self.run_cli('definitiva')
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
        path.write_bytes(path.read_bytes() + b'x')
        with self.assertRaises(main.Refused):
            self.run_cli('definitiva')
        self.assertEqual(len(self.printed), 1)

    def test_email_non_partita_si_ritenta_al_comando_successivo(self):
        def fail(*_):
            raise OSError('SMTP non raggiungibile')
        with self.assertRaises(main.Refused):
            self.run_cli('definitiva', send=fail)
        self.assertEqual(Registry(self.output / 'definitivi').get('2026-09-26')['email'], 'non confermata')
        self.assertEqual(self.printed, [])
        self.run_cli('definitiva')
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.printed), 1)


if __name__ == '__main__':
    unittest.main()
