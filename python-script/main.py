import argparse
import getpass
import os
import sys
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

from chiusura import Registry, SmtpSettings, make_read_only, print_file, send_to_manager, sha256
from report_generator import build_report, euro, generate_excel
from shopify_client import ShopifyClient

# Salva sempre nella cartella output del progetto, anche se lanciato da VS Code o da un'altra cartella.
OUTPUT = Path(__file__).resolve().parent / 'output'


class Refused(Exception):
    """Operazione non consentita: il messaggio spiega all'operatore cosa fare."""


def load_report(client, report_date, shop_name, status='bozza', closed_by=None):
    # Il nome del negozio viene letto da Shopify; resta possibile forzarlo con --shop-name o SHOP_NAME.
    if not shop_name:
        try:
            shop_name = client.get_shop_display_name()
        except Exception:
            shop_name = os.getenv('SHOPIFY_SHOP', 'Negozio')
    timezone = client.get_shop_info().get('ianaTimezone') or 'Europe/Rome'
    orders = client.get_orders_for_date(report_date, timezone)
    return build_report(orders, report_date, shop_name, timezone, status=status, closed_by=closed_by)


def email_text(report, digest):
    lines = [f'{report.title} – {report.shop_name}', report.status_label(), '']
    for label, value, kind, hint, _ in report.kpis:
        lines.append(f'{label}: {euro(value) if kind == "money" else value} ({hint})')
    lines += ['', 'In allegato il rapportino definitivo in Excel, con fogli protetti da modifiche.',
              f'Impronta SHA-256 del file: {digest}']
    return '\n'.join(lines)


def send_to_printer(printer, path):
    try:
        printer(path)
    except OSError as error:
        raise Refused(f'Stampa non riuscita ({error}). Il file è in {path}: '
                      'aprilo e stampalo, oppure rilancia lo stesso comando.')


def draft(args, client, printer, output):
    report = load_report(client, args.date, args.shop_name)
    path = output / f'Rapportino_{args.date}_bozza.xlsx'
    generate_excel(report, path)
    print(f'Bozza creata: {path} - vendite: {len(report.sales)}')
    if args.stampa == 'bozza':
        send_to_printer(printer, path)
        print('Bozza inviata alla stampante.')
    return path


def finalize(args, client, env, send, printer, output, user):
    folder = output / 'definitivi'
    registry = Registry(folder)
    entry = registry.get(args.date)
    settings = None
    if entry:
        # Già chiuso: si ristampa il file salvato, mai rigenerato, se l'impronta corrisponde.
        path = folder / entry['file']
        if not path.exists() or sha256(path) != entry['sha256']:
            raise Refused(f'Il file definitivo {path} risulta modificato o rimosso: non viene ristampato. '
                          'Verificare con il gestore.')
        print(f'Rapportino del {args.date} già definitivo: ristampo {path}')
    else:
        # Senza email al gestore configurata il giorno non si chiude.
        settings = SmtpSettings.from_env(env)
        path = folder / f'Rapportino_{args.date}_definitivo.xlsx'
        if path.exists():
            raise Refused(f'Esiste già {path} ma non è nel registro: non viene sovrascritto.')
        report = load_report(client, args.date, args.shop_name, status='definitivo', closed_by=user)
        generate_excel(report, path)
        make_read_only(path)
        digest = sha256(path)
        entry = {
            'file': path.name,
            'sha256': digest,
            'chiuso_il': report.generated_at.isoformat(timespec='seconds'),
            'operatore': user,
            'email': 'da inviare',
            'oggetto': f'{report.title} – DEFINITIVO – {report.shop_name}',
            'testo': email_text(report, digest),
            'stampe': [],
        }
        registry.set(args.date, entry)
        print(f'Rapportino definitivo creato: {path} - vendite: {len(report.sales)}')
    if entry['email'] != 'inviata':
        settings = settings or SmtpSettings.from_env(env)
        try:
            send(settings, path, entry['oggetto'], entry['testo'])
        except Exception as error:
            entry['email'] = 'non confermata'
            registry.set(args.date, entry)
            raise Refused(f'Definitivo salvato, ma l\'email al gestore non è partita ({error}). '
                          'Controlla la casella del gestore e rilancia lo stesso comando per ritentare invio e stampa.')
        entry.update(email='inviata', gestore=settings.manager)
        registry.set(args.date, entry)
        print(f'Email inviata al gestore ({settings.manager}).')
    send_to_printer(printer, path)
    entry['stampe'].append(datetime.now().isoformat(timespec='seconds'))
    registry.set(args.date, entry)
    print('Rapportino definitivo inviato alla stampante.')
    return path


def run(args, client, env=None, send=send_to_manager, printer=print_file, output=OUTPUT, user=None):
    env = os.environ if env is None else env
    if args.stampa == 'definitiva':
        return finalize(args, client, env, send, printer, output, user or getpass.getuser())
    closed = Registry(output / 'definitivi').get(args.date)
    if closed:
        raise Refused(f'Il rapportino del {args.date} è già definitivo ({closed["file"]}): '
                      'per ristamparlo usa --stampa definitiva.')
    return draft(args, client, printer, output)


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Genera rapportino vendite Shopify')
    parser.add_argument('--date', default=date.today().isoformat(), help='Data report YYYY-MM-DD')
    parser.add_argument(
        '--shop-name',
        default=os.getenv('SHOP_NAME'),
        help='Nome negozio stampato sotto il titolo. Se omesso, viene letto da Shopify.'
    )
    parser.add_argument(
        '--stampa',
        choices=['bozza', 'definitiva'],
        help='bozza: crea e stampa la bozza. definitiva: chiude il giorno, invia il file al gestore e lo stampa.'
    )
    args = parser.parse_args()
    try:
        run(args, ShopifyClient())
    # Errori Shopify, rete, configurazione o file: messaggio leggibile all'operatore invece dello stack trace.
    except (Refused, ValueError, OSError, RuntimeError) as error:
        print(f'Errore: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
