# Verifiche — 27 settembre 2026

Ambiente: Windows ARM64, Node 24.15, npm 11.12. Database temporaneo PostgreSQL 18.4 eseguito localmente su loopback tramite binario x64; nessun accesso al database del negozio.

| Verifica | Risultato |
|---|---|
| TOML: embedded, scope, callback, webhook/versione coerenti | PASS; Client ID e URL sono placeholder da configurare |
| TypeScript | PASS |
| Test unitari e integrazione simulata | 17 PASS: calcoli, ambiente, auth/API, webhook, export, paginazione |
| Build client e server Remix | PASS |
| Migrazione PostgreSQL iniziale | PASS; seconda esecuzione senza migrazioni pendenti |
| Session storage reale, chiusura/riapertura client DB e refresh token | PASS |
| Uscite: importo, shop, doppio invio concorrente, validazione | PASS su PostgreSQL |
| Handler HTTP reali del build eseguiti in memoria | PASS: health 200, redirect login, pagina login, API senza bearer 401, JWT non valido 401, webhook HMAC non valido rifiutato |
| Generazione e riapertura XLSX | PASS; note interpretate come testo, non formule |
| Generazione PDF | PASS struttura header/EOF; verifica visiva multipagina da completare |
| Audit dipendenze runtime | BLOCCO: 7 high / 2 moderate (9 pacchetti), nessun critical |
| OAuth reale, installazione/reinstallazione su store, permessi staff, POS, SMTP e stampa fisica | NON ESEGUITI; richiedono development store/servizi configurati |
| Deploy e immagine Docker | NON ESEGUITI |

Il test HTTP usa il request handler di produzione in memoria: non certifica HTTPS, reverse proxy, navigazione iframe o interazione browser. I test unitari dei webhook simulano anche il caso autenticato; il test HTTP verifica il rigetto della firma invalida con il vero SDK. Non sono stati generati token Shopify reali né inviate email.

Il runtime Prisma inizialmente falliva su ARM64 con engine nativo; la versione finale usa l'adattatore PostgreSQL JavaScript e passa il test DB. I limiti funzionali (EUR, tutte le sedi, ordini storici, contanti senza fondo, caratteri PDF) sono elencati nel README.

Comandi ripetibili: `npm ci`, `npm run setup` con DB di test, `npm run check`, `npm run test:db`, `npm run test:http` con `TEST_DATABASE_URL`. Non copiare credenziali reali nei test. L'audit viene riprodotto con `npm audit --omit=dev`; leggere `SECURITY.md` prima di un rilascio.

## Aggiornamento 28 settembre 2026 — nuovo layout, stampa bozza e definitiva

| Verifica | Risultato |
|---|---|
| `npm run check`: TOML, TypeScript, 32 test, build | PASS |
| Chiusura definitiva con database e SMTP simulati: copia servita al posto dei dati ricalcolati, una sola copia anche con due operatori, lock sulle uscite, email al gestore solo alla chiusura, esito incerto e reinvio | PASS (test unitari) |
| Excel/PDF definitivi protetti (fogli bloccati, PDF con permessi senza modifica), bozze libere e con filigrana | PASS (test unitari e verifica visiva) |
| Anteprima web desktop e mobile (390 px), stampa browser A4 orizzontale di bozza e definitivo, con dati di esempio (`npm run preview:report`) | PASS verifica visiva |
| Excel aperto con LibreOffice: A4 orizzontale, blocchi ordine e riepilogo non spezzati | PASS verifica visiva |
| PDF multipagina: ordini brevi interi, ordine da 45 righe con intestazioni ripetute | PASS verifica visiva |
| Campi `paymentGatewayNames` e `subtotalPriceSet` aggiunti alla query ordini | Validati sullo schema Admin API 2026-07; non provati su uno store reale |
| Migrazione `202609280001_report_closure` (tabella e trigger di immutabilità) e `npm run test:db` esteso alle chiusure | NON ESEGUITI: nessun PostgreSQL disponibile in questa sessione; SQL della tabella generato da Prisma, trigger scritto a mano |

Non rieseguiti in questo aggiornamento: test HTTP, audit dipendenze, prove su development store e invio reale al gestore.

## Aggiornamento 28 settembre 2026, uso sullo store

L'app è stata provata dall'autore sullo store Shopify ed è usata ogni giorno per la chiusura della giornata. I dettagli delle prove sullo store non sono riportati in questo file.

## Audit del 29 settembre 2026

Copia appena scaricata dalla repository, Windows, Node 24.15, Python 3.14. Nessun accesso allo store, nessuna email o stampa reale.

| Verifica | Risultato |
|---|---|
| `npm ci` + `npm run check` su copia nuova, prima delle correzioni | FALLIVA: typecheck senza client Prisma generato (5 errori). Ora `check` esegue `db:generate` |
| `npm run check`: Prisma, TOML, TypeScript, 43 test (9 file), build | PASS |
| Prettier su `app/` e `tests/` | PASS |
| Limite di velocità Shopify (THROTTLED): attesa calcolata, nuovo tentativo, rinuncia dopo 4 tentativi | PASS (test unitari; senza la correzione 3 test su 4 falliscono) |
| Uscite ripetute: stessi dati senza doppioni, dati diversi rifiutati (409), importi non validi con messaggio (422) | PASS (test unitari) |
| Invio email manuale: esito registrato, SMTP non confermato (502, esito incerto), richiesta ripetuta (409) | PASS (test unitari) |
| Pagina reale `app._index.tsx` in Chrome headless con Remix, App Bridge e rete simulati: secondo invio email, focus ed Esc nella conferma, importo non valido, ripetizione uscite, chiusura e stampa unica, nessuna stampa inattesa | PASS 11/11 (sulla versione precedente 4 controlli falliscono) |
| Handler HTTP della build di produzione in memoria senza database: salute 503, redirect, login con `lang="it"`, API 401, origine estranea 403, webhook con firma falsa rifiutato | PASS |
| Script Python: 10 test (calcolo, client Shopify, stampa definitiva) | PASS (5 falliscono senza le correzioni) |
| Query dello script (ordini con `pageInfo` sulle righe e righe oltre le prime 100) | Valide sullo schema Admin API 2026-07 (validatore Shopify) |
| `npm audit --omit=dev` | Invariato: 9 pacchetti (7 high, 2 moderate); nessuna correzione compatibile, solo migrazione a React Router 7 |
| Migrazioni, trigger, `test:db` e `test:http` su PostgreSQL | NON ESEGUITI: nessun PostgreSQL o Docker attivo su questa macchina |
