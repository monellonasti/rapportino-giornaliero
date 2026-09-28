# Rapportino giornaliero

Il rapportino vendite di fine giornata per negozi che vendono con Shopify POS: prima scritto a mano in Excel, ora generato dagli ordini Shopify, chiuso come definitivo e inviato da solo al gestore.

![Rapportino definitivo, chiuso e inviato al gestore](docs/screenshots/rapportino-giornaliero-06-definitivo-desktop.png)

## Il problema

In quattro negozi, a fine giornata, il personale scriveva a mano in un foglio Excel le vendite, una per una, salvava il file e lo mandava per email al proprietario o al responsabile. Servivano in media 20 minuti, di più nelle giornate intense. Il foglio perdeva formule e formattazione, e con loro il totale giusto; non aveva indicatori, e il file inviato restava modificabile da chiunque.

## La soluzione

1. **Vendite su Shopify POS.** Ho configurato un tablet con Shopify POS: ogni vendita viene registrata con prodotti, prezzi, sconti e metodo di pagamento.
2. **Primo script, luglio 2026.** Uno script Python genera il rapportino in Excel direttamente dagli ordini del giorno.
3. **App Shopify e script aggiornato, settembre 2026.** Un'app dentro l'Admin di Shopify mostra il rapportino, lo esporta in PDF ed Excel, registra le uscite di cassa e calcola i contanti attesi. La stampa definitiva chiude la giornata e manda PDF ed Excel al gestore. Lo script Python ha ricevuto lo stesso design e le stesse regole.

Il documento resta quello che il personale conosceva: una vendita dopo l'altra, i totali di cassa in fondo. Dove servivano 20 minuti ora bastano un clic e, per la chiusura definitiva, una conferma.

## Prima e dopo

| Il foglio compilato a mano (ricostruito con dati inventati) | Il rapportino di oggi |
| --- | --- |
| ![Foglio Excel compilato a mano](docs/screenshots/rapportino-giornaliero-00-foglio-manuale.png) | ![Rapportino in bozza nell'app](docs/screenshots/rapportino-giornaliero-02-app-bozza-desktop.png) |

La stessa vendita nei tre passaggi: scritta a mano, nel primo script (ora in UTC, sconto sull'ordine perso) e nell'app (ora locale, totale che torna).

![La stessa vendita a mano, nel primo script e nell'app](docs/screenshots/rapportino-giornaliero-14-prima-dopo-stesso-ordine.png)

## Cosa fa

- **Rapportino del giorno dagli ordini Shopify**, nel fuso orario del negozio: 6 indicatori, una scheda per ogni vendita con prezzi, sconti e pagamento, riepilogo con pagamenti del giorno e cassa contanti.
- **Conti che tornano.** Lo sconto fatto sull'ordine entra nel Totale merce; i contanti arrivano dalle transazioni, anche nei pagamenti misti carta più contanti; rimborsi e uscite di cassa scalano i contanti attesi.
- **Bozza e definitiva.** La bozza si stampa quante volte serve ed è segnata come BOZZA su pagina, PDF ed Excel. La definitiva salva una copia che non si modifica più, nemmeno dal database, blocca nuove uscite su quel giorno e si può solo ristampare.
- **Email automatica al gestore** alla chiusura, con il PDF (stampabile ma non modificabile) e l'Excel (fogli protetti). Se l'invio non è confermato, l'app lo segnala e permette di reinviare senza doppioni.
- **Un design, tre formati:** pagina stampabile in A4 orizzontale, PDF ed Excel con la stessa palette e senza vendite spezzate tra due pagine.
- **Script Python** per la stessa procedura da riga di comando: `--stampa bozza` o `--stampa definitiva`, con registro e impronta SHA-256 dei definitivi.

| Riepilogo e cassa | Conferma della stampa definitiva |
| --- | --- |
| ![Riepilogo giornaliero e cassa contanti](docs/screenshots/rapportino-giornaliero-04-riepilogo-cassa-desktop.png) | ![Pannello di conferma](docs/screenshots/rapportino-giornaliero-05-conferma-definitiva-desktop.png) |
| **PDF definitivo inviato al gestore** | **Excel dello script Python (bozza)** |
| ![PDF definitivo](docs/screenshots/rapportino-giornaliero-07-pdf-definitivo.png) | ![Excel dello script Python](docs/screenshots/rapportino-giornaliero-08-script-python-excel-bozza.png) |

Tutte le immagini sono in [`docs/screenshots`](docs/screenshots).

## Come è fatto

| Cartella | Contenuto |
| --- | --- |
| [`shopify-app/`](shopify-app) | App Shopify incorporata nell'Admin: Remix 2.17, React 18, TypeScript, Admin GraphQL API 2026-07, PostgreSQL con Prisma 6, ExcelJS e PDFKit per gli export, nodemailer per l'email, Vitest (32 test). |
| [`python-script/`](python-script) | Script Python 3 con openpyxl: stesso rapportino in Excel, invio SMTP al gestore e stampa sulla stampante predefinita. |
| [`docs/screenshots/`](docs/screenshots) | Immagini del progetto con dati inventati. |

Alcune scelte tecniche:

- La chiusura definitiva gira in una transazione con un lock PostgreSQL per negozio e giorno, condiviso con la registrazione delle uscite: due clic o due operatori non producono due copie diverse.
- Un trigger PostgreSQL impedisce di modificare o cancellare un rapportino definitivo; resta aggiornabile solo l'esito dell'email.
- La giornata è calcolata nel fuso orario del negozio; i rimborsi fatti oggi su ordini di giorni precedenti entrano nel conto di oggi.
- Importi in centesimi interi, con decimal.js per gli arrotondamenti.

## Avvio

- **App:** istruzioni complete in [`shopify-app/README.md`](shopify-app/README.md) (Node 22, PostgreSQL, Shopify CLI).
- **Script:** istruzioni in [`python-script/README.md`](python-script/README.md) (Python 3.11+, `pip install -r requirements.txt`, file `.env` creato da `.env.example`).

Le credenziali vanno solo nei file `.env`, che git ignora.

## Stato

- Il rapportino automatico è in uso in quattro negozi.
- L'app è completa e testata in locale con 32 test automatici, ma non è ancora stata provata sullo store reale: prima del rilascio servono la migrazione del database, le prove su un development store e un invio email e una stampa reali. Dettagli in [`SECURITY.md`](shopify-app/SECURITY.md) e [`TEST_RESULTS.md`](shopify-app/TEST_RESULTS.md).
- Limiti noti: solo EUR, contanti attesi senza fondo cassa iniziale, prezzo di confronto preso dal catalogo attuale e non storico.

## Dati

Nel repository non ci sono dati reali: negozio, prodotti, importi e operatori delle immagini sono inventati.

## Autore

Aniello Nasti ([@monellonasti](https://github.com/monellonasti)): analisi del processo, configurazione del tablet Shopify POS, design del rapportino, sviluppo di app e script, con l'aiuto di Claude Code.

## Licenza

Tutti i diritti riservati © 2026 Aniello Nasti. Il codice è pubblicato per presentare il progetto: non è concesso riutilizzarlo, in tutto o in parte, senza autorizzazione scritta dell'autore.
