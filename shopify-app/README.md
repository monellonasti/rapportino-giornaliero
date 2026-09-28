# Rapportino Giornaliero — Shopify Admin App

Versione 0.2.0. App embedded Remix/TypeScript, Shopify App Bridge, PostgreSQL/Prisma. Lo script Python che produce lo stesso rapportino è nella cartella [`../python-script`](../python-script).

**Stato: base funzionante per collaudo in development store, non approvata per produzione.** Autenticazione/configurazione sono implementate; restano test reali Shopify e vulnerabilità upstream Remix descritte in `SECURITY.md`. `npm run deploy` esegue controlli e si ferma se l'audit runtime non passa.

## Cosa contiene

- Accesso embedded con `authenticate.admin`, token exchange gestito dal SDK, sessioni online per rispettare i permessi dell'operatore e sessioni offline persistenti con refresh token. Route `/auth/*` e login Shopify; nessun token Admin nel browser.
- Scope `read_orders,read_products,read_locations`, configurazione app TOML e web TOML per Shopify CLI.
- Database PostgreSQL con migrazione versionata per sessioni, uscite ed esiti email. Adattatore `@prisma/adapter-pg`, compatibile anche con Node Windows ARM64 senza motore Prisma nativo per le query.
- Rapportino per data nel fuso del negozio; ordini/articoli paginati, confronto catalogo/prezzo vendita, sconti, riepilogo, pagamenti.
- Uscite con data, importo, causale, note e ID operatore ricavato dalla sessione; importi in centesimi, validazione e protezione dal doppio invio. Sono registrazioni additive: modifica/annullamento contabile con audit trail è un prossimo sviluppo, non si cancellano uscite dall'interfaccia.
- Rapportino con lo schema del vecchio file Python in versione più leggibile: indicatori principali in alto, un blocco per vendita (ora, canale, pagamento, righe prodotto, riconciliazione con il totale ordine), riepilogo con vendite, pagamenti del giorno e cassa contanti. Stesso layout in anteprima, stampa browser A4 orizzontale, Excel con quattro fogli e PDF; email con entrambi gli allegati e i numeri principali nel testo. Nessun invio email automatico all'avvio.
- Stampa bozza e stampa definitiva (vedi sezione 5): la definitiva chiude il giorno, salva una copia non modificabile e la invia al gestore.
- Webhook firmati di disinstallazione e cambio scope: invalidano tutte le sessioni dello shop. Le uscite e i rapportini definitivi restano nel database per continuità contabile.

## 1. Prerequisiti e database

Node **22 LTS >=22.12** (anche Node 24 supportato), npm e PostgreSQL 16+ oppure Docker Desktop avviato. Il lockfile è incluso; usare `npm ci`.

```powershell
cd shopify-app
npm ci
Copy-Item .env.example .env
docker compose up -d db
```

Se hai un database PostgreSQL esistente, crea un database dedicato e imposta `DATABASE_URL`: Docker non è obbligatorio. Il volume `rapportino_db` conserva i dati tra i riavvii; non eseguire `docker compose down -v` se vuoi conservarli. Il compose è solo per sviluppo, non è un database pronto per internet.

## 2. Shopify Dev Dashboard e collegamento CLI

1. Accedi a [Shopify Dev Dashboard](https://dev.shopify.com/) con l'organizzazione che possiede/gestisce il negozio. Crea un'app dedicata **Rapportino Giornaliero DEV** e un development store per i test. Per lo store reale predisponi un'app distinta, con credenziali e database separati.
2. Dalla cartella esegui `npm run config:link` e seleziona l'app DEV. La CLI apre l'accesso Shopify nel browser. Non riutilizzare alla cieca il vecchio client Python.
3. Mantieni in `shopify.app.toml` `embedded = true`, gli scope richiesti, `use_legacy_install_flow = false`, le due sottoscrizioni webhook e API `2026-07`. `config:link` può riscrivere il file: esegui `npm run config:check` e ripristina eventuali sezioni mancanti prima di proseguire.
4. In `.env`: `SHOPIFY_API_KEY` = Client ID; `SHOPIFY_API_SECRET` = Client secret; `ALLOWED_SHOPS` = dominio esatto del development store (`nome.myshopify.com`). Non usare dominio personalizzato o URL completo. Puoi elencare più store autorizzati separati da virgole, tutti della stessa organizzazione/destinazione email.
5. Il TOML contiene solo il Client ID pubblico, mai il secret. `SHOPIFY_APP_URL` è l'origine HTTPS dell'app; in sviluppo viene fornita dal tunnel della CLI. Durante `npm run dev` la CLI aggiorna application URL e redirect sullo store di sviluppo. Lascia `automatically_update_urls_on_dev = true` solo nella configurazione DEV.
6. `SCOPES` nell'ambiente deve corrispondere al TOML. Per questa versione sono richiesti solo permessi di lettura, nessun `write_products`.

Il placeholder `replace-me.example.com` rende il template leggibile ma non rappresenta un endpoint funzionante. Va sostituito per avvio fuori dalla CLI/deploy. `npm run env:check` rifiuta i placeholder; in sviluppo eseguirlo con l'URL corrente del tunnel se vuoi verificare il file `.env` separatamente.

## 3. Avvio e installazione nel development store

```powershell
npm run setup
npm run dev -- --store nome-dev.myshopify.com
```

`setup` genera il client e applica `prisma migrate deploy`; la CLI lo esegue anche come `predev`, in modo idempotente. Usa il collegamento preview indicato dalla CLI, installa l'app e approva i permessi. Aprila da **Shopify Admin → App → Rapportino Giornaliero**. Non navigare direttamente agli endpoint API: richiedono il bearer token di App Bridge.

L'app usa `AppDistribution.SingleMerchant`: è destinata a una distribuzione personalizzata per questo commerciante, non a una pubblicazione App Store. Per installarla su uno store reale imposta la distribuzione personalizzata nell'interfaccia Shopify dell'app di produzione, seleziona il negozio e usa il link di installazione generato. Se il negozio appartiene a un'altra organizzazione o non è eleggibile, verifica le opzioni di distribuzione offerte da Shopify prima di cambiare questa architettura.

Il vecchio `client_credentials` del Python non viene usato dalla web app. L'embedded app usa session token App Bridge + token exchange del pacchetto ufficiale; non è necessario copiare manualmente access token o costruire URL OAuth a mano.

## 4. Variabili e email

| Variabile                                | Uso                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Client ID e secret dell'app corretta                                                                |
| `SHOPIFY_APP_URL`                        | Origine HTTPS pubblica, senza path                                                                  |
| `SCOPES`                                 | Scope coerenti con TOML                                                                             |
| `DATABASE_URL`                           | PostgreSQL dedicato; in produzione TLS e credenziali del secret manager                             |
| `ALLOWED_SHOPS`                          | Domini myshopify autorizzati, verificati dopo autenticazione                                        |
| `CASH_GATEWAYS`                          | Nomi esatti dei gateway contanti, default `cash,contanti`; confrontare con la tabella pagamenti POS |
| `EMAIL_ENABLED`                          | `false` per default                                                                                 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`  | Server SMTP; 465/true oppure 587/false con STARTTLS obbligatorio                                    |
| `SMTP_USER`, `SMTP_PASSWORD`             | Credenziali SMTP                                                                                    |
| `EMAIL_FROM`, `EMAIL_TO`                 | Indirizzi singoli validi, configurati sul server                                                    |
| `EMAIL_GESTORE`                          | Gestore che riceve la stampa definitiva; se vuoto si usa `EMAIL_TO`                                 |

L'utente non può impostare un destinatario arbitrario dall'interfaccia. Il pulsante email è attivo solo se la configurazione SMTP è completa. `sent` significa accettato dal server SMTP, non consegna certificata. Un errore dopo l'invio può risultare `uncertain`: verificare la casella e i log del provider prima di ripetere l'operazione. La stessa richiesta non è inviata due volte; ricaricare la pagina genera una nuova richiesta. Non è presente una coda con retry automatici.

## 5. Stampa bozza e stampa definitiva

- **Stampa bozza**: stampa di controllo in qualsiasi momento, con filigrana «BOZZA» su ogni pagina. Non chiude il giorno e non invia email.
- **Stampa definitiva**: dopo una conferma, il server rilegge i dati da Shopify e le uscite registrate, salva una copia del rapportino (tabella `ReportClosure`), la invia al gestore (`EMAIL_GESTORE`, altrimenti `EMAIL_TO`) con PDF ed Excel allegati e poi apre la stampa. È disponibile solo con l'email configurata e da una sessione operatore; l'operatore che chiude viene registrato.
- **Non modificabile**: dopo la chiusura pagina, stampa, export ed email usano sempre la copia salvata, anche se in Shopify cambiano i dati; le nuove uscite per quel giorno sono rifiutate. Un trigger PostgreSQL impedisce modifica e cancellazione della copia (resta aggiornabile solo l'esito dell'email). Il PDF definitivo è protetto da modifiche e i fogli Excel sono bloccati con password casuale non salvata.
- Chiusura e nuove uscite dello stesso giorno sono serializzate con un lock del database: una stampa definitiva non può includere a metà un'uscita registrata nello stesso istante. Due operatori che chiudono insieme producono una sola copia e una sola email.
- Se l'SMTP non conferma l'invio, il definitivo resta salvato e l'app segnala l'esito incerto con il pulsante «Reinvia al gestore»: verificare la casella prima di reinviare. «Ristampa definitiva» non invia altre email.
- Annullare una chiusura richiede un intervento amministrativo sul database; non è previsto dall'interfaccia.

## 6. Regole del report e limiti noti

- Valuta supportata **EUR**, tutte le sedi aggregate. `read_locations` è predisposto; il filtro per sede/cassa non è ancora implementato.
- La sezione vendite comprende ordini **creati** nella data scelta, escluse vendite test e ordini annullati. Nelle bozze i valori sono quelli restituiti da Shopify al momento della richiesta; dopo la stampa definitiva si usa sempre la copia salvata (sezione 5). Vendite e incassi non sono equivalenti (es. ordine non ancora pagato).
- Gli incassi comprendono solo transazioni `SUCCESS` di tipo `SALE`/`CAPTURE`; i rimborsi `SUCCESS` di tipo `REFUND` sono separati. Il filtro temporale usa `processedAt` nel fuso negozio, con fine giorno esclusiva. `AUTHORIZATION`, `VOID` e tentativi falliti non incrementano la cassa.
- Per trovare rimborsi su ordini precedenti, si leggono anche ordini aggiornati da inizio giornata in poi. Questo include ordini modificati dopo la data selezionata: le transazioni sono poi filtrate per il giorno. Il limite sincrono è 200 pagine per ricerca (1.000 ordini vendite / 600 ordini candidati ai movimenti), 100 transazioni per ordine e 100 pagine aggiuntive di articoli. Al raggiungimento del limite la generazione è bloccata, non produce un totale parziale.
- **Contanti attesi = incassi contanti − rimborsi contanti − uscite**. Non comprende fondo iniziale, versamenti, trasferimenti o riconciliazione della cassa fisica. Non è una chiusura fiscale certificata.
- Accesso Shopify standard limitato agli ordini degli ultimi 60 giorni. Anche un rimborso odierno su un ordine più vecchio può mancare. Per la completezza storica occorre approvazione `read_all_orders`, aggiornamento TOML/SCOPES e nuova autorizzazione. L'app mostra questo limite nel report; non pretende che il totale sia sempre completo.
- Il prezzo confronto è quello **attuale** del catalogo, non il prezzo storico alla vendita. In assenza del confronto si usa il prezzo venduto; gli omaggi restano a zero. Sconto confronto e sconti Shopify sono indicatori distinti. I totali di riga sono autorevoli; il prezzo unitario visualizzato è arrotondato ai centesimi.
- Il PDF usa font standard occidentali: caratteri non supportati sono sostituiti da `?`. Il testo completo Unicode resta in Excel e anteprima. Per cataloghi multilingua aggiungere un font Unicode con licenza appropriata.
- Per le bozze esportazione ed email rigenerano i dati al momento della richiesta: nuovi ordini o nuove uscite possono cambiare i valori rispetto all'anteprima precedente. Per un giorno chiuso usano la copia definitiva.
- Ogni vendita mostra il metodo di pagamento registrato da Shopify sull'ordine (`paymentGatewayNames`, con etichette come Carta o Contanti; i gateway in `CASH_GATEWAYS` appaiono come «Contanti»).
- La riga «Totale merce» di ogni vendita usa il subtotale Shopify (`subtotalPriceSet`): comprende gli sconti sull'ordine (es. arrotondamenti in cassa), che i totali di riga escludono, e li indica accanto all'etichetta. Con la spedizione riconcilia il totale ordine; eventuali differenze residue (tasse escluse, mance, sconti sulla spedizione) compaiono come «Altre voci dell'ordine». Totale merce e sconto confronto del riepilogo seguono la stessa regola.
- Stampa tramite dialogo browser, non stampa silenziosa. Anteprima, Excel e PDF riprendono la struttura del vecchio file Python ma non ne sono copie grafiche identiche.

## 7. Test automatici e collaudo Shopify

```powershell
npm run check
```

Controlla TOML, TypeScript, test unitari e build. I test verificano fuso/orario legale, pagamenti misti, rimborsi di ordini precedenti, duplicati, omaggi, limiti, validazione ambiente, protezioni API/webhook ed esportazione Excel/PDF.

Per vedere il rapportino senza Shopify né database:

```powershell
npm run preview:report
```

Crea in `preview/` anteprima HTML, Excel e PDF con dati di esempio. Con `npm run preview:report -- --ordini 30` simula una giornata con molte vendite per controllare l'impaginazione su più pagine.

Per il test reale PostgreSQL usa **solo un database di test dedicato** già migrato:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://utente:password@localhost:5432/rapportino_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run setup
npm run test:db
```

Il test inserisce record sintetici con shop univoco, verifica persistenza delle sessioni dopo riconnessione, refresh token, validazione e idempotenza concorrente delle uscite, poi elimina soltanto i suoi record. Riapri il terminale prima di tornare al database normale per non riutilizzare le variabili di test.

Prima del rilascio, sul development store:

1. Installa e apri l'app dentro Admin; chiudi e riapri. Verifica che non vi siano loop di accesso. Riavvia il processo web: le sessioni e le uscite devono rimanere.
2. Usa un secondo operatore con permessi ridotti: accesso ordini deve rispettare le autorizzazioni Shopify. Tentare API senza token / con token alterato / shop contraffatto non deve mostrare dati.
3. Crea vendite normali del development store, anche POS se disponibile: contanti 40 + carta 60; rimborso contanti 10; uscita 5. Atteso contanti senza fondo **25 EUR**. Gli ordini marcati da Shopify `test=true` sono esclusi dal report.
4. Prova rimborso su ordine di un giorno precedente, annullamento, omaggio, giorno vuoto, uscita ripetuta, ordini con più di 20 articoli e più pagine. Confronta i gateway reali e le cifre con Shopify/POS.
5. Confronta anteprima/Excel/PDF/stampa e verifica data, note, importi e più pagine. Abilita SMTP su una casella di test e prova l'invio manuale una sola volta. Prova una stampa definitiva: il gestore deve ricevere PDF ed Excel, la pagina deve mostrare «Definitivo», le nuove uscite di quel giorno devono essere rifiutate e il PDF non deve essere modificabile.
6. Disinstalla: verifica eliminazione delle sessioni e conservazione delle uscite. Reinstalla e ricontrolla scope/riconciliazione. Un webhook senza HMAC valido deve essere rifiutato.

Le prove reali OAuth/installazione/POS/SMTP richiedono le tue configurazioni e non sono sostituite dai test locali. Vedi `TEST_RESULTS.md` per l'esito effettivamente ottenuto.

## 8. Deploy, dopo risoluzione dei blocchi

`shopify app deploy` pubblica **configurazione e versioni Shopify**, non ospita il server Remix o il database. Servono un host Node/Docker con HTTPS stabile e PostgreSQL gestito.

1. Risolvi `SECURITY.md` e completa il collaudo. Crea app PROD separata e collega il suo Client ID. Non usare il dev tunnel come application URL permanente.
2. Nel TOML di produzione sostituisci `client_id`, `application_url`, `auth.redirect_urls` con `https://tuo-host/auth/callback`. Imposta `automatically_update_urls_on_dev = false`. Configura le stesse credenziali e origine nell'ambiente server. Non avviare `app dev` contro l'app PROD.
3. Provisiona PostgreSQL con TLS, backup/ripristino verificati, accesso di rete ristretto, cifratura a riposo e retention. Sessioni/access token sono dati sensibili: non esporre dump o log. Le uscite conservate dopo disinstallazione richiedono una procedura concordata di esportazione e cancellazione amministrativa.
4. Build: `npm ci`, `npm run db:generate`, `npm run build`. In alternativa `docker build -t rapportino .`. Non passare segreti in fase di build e non inserirli nell'immagine.
5. Esegui **una volta come release job** `npm run db:migrate` con `DATABASE_URL` di produzione, poi avvia `npm start` con `NODE_ENV=production`, `PORT` dell'host e tutte le variabili server. Più istanze web devono condividere lo stesso database. Nessun SQLite o filesystem locale per sessioni.
6. Verifica `GET /healthz`: `200 ok` se il database è raggiungibile, `503` altrimenti. Configura timeout e rate limit sul proxy, incluso `/api/email`. Il processo non esegue invii automatici.
7. Da un checkout con le variabili PROD corrette, `npm run deploy`. Esegue controlli configurazione, ambiente, test, build e audit prima di contattare Shopify. Con le vulnerabilità residue attuali il controllo **fallisce intenzionalmente**. Non aggirarlo per considerare l'app pronta.
8. Una volta pubblicata la versione, installa sullo store tramite il link della distribuzione personalizzata e ripeti il test essenziale nell'Admin.

Per rollback conserva l'immagine precedente e un backup PostgreSQL verificato. Le migrazioni non si annullano automaticamente: verificare compatibilità schema prima di ripristinare codice precedente. Non fare `db push` o reset su produzione.

## Risoluzione problemi

- Login continuo: verificare Client ID coerente, URL tunnel/host, callback, allowlist, session table e App Bridge. Aprire dall'Admin; non copiare solo un URL iframe privo dei parametri Shopify.
- `403`: negozio fuori `ALLOWED_SHOPS`, token/permessi operatore non validi o origine API diversa da `SHOPIFY_APP_URL`.
- Errore DB: verificare servizio, URL, TLS e `npm run setup`. Sul PC ARM64 la query usa l'adattatore JS; non ripristinare il vecchio engine nativo.
- Report indisponibile: permessi insufficienti, valuta diversa da EUR, data errata, soglie superate, errore GraphQL/throttling. Nessun report parziale viene presentato come completo.
- Dati mancanti oltre 60 giorni: vedere `read_all_orders`, non cambiare la data per aggirare i permessi.

## Riferimenti ufficiali

- [Configurazione Shopify CLI](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration)
- [Autenticazione e session storage Remix](https://shopify.dev/docs/api/shopify-app-remix/latest/entrypoints/shopifyapp)
- [Custom app e distribuzione](https://shopify.dev/docs/api/shopify-app-remix/latest/guide-custom-apps)
- [Ordini e accesso storico](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)

L'implementazione segue il template ufficiale Remix ma non eredita una garanzia di sicurezza o di compatibilità futura. Il successivo lavoro prioritario è aggiornare lo stack web a una linea priva delle segnalazioni residue, valutando il successore Shopify React Router prima del rilascio reale.
