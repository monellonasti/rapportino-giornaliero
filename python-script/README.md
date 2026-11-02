# Shopify Rapportino Vendite

Software per generare il rapportino giornaliero da ordini Shopify e Shopify POS, con lo stesso layout dell'app Shopify "Rapportino Giornaliero".

## Cosa fa
- Scarica gli ordini di una data da Shopify Admin GraphQL API, nel fuso orario del negozio. Esclude ordini di test e annullati.
- Raggruppa il report per ordine/vendita, con ora, canale e metodo di pagamento.
- Mostra per ogni prodotto: quantità, prezzo di confronto, prezzo vendita, totale confronto, sconto importo, sconto %, totale vendita.
- Nella riga "Totale merce" di ogni vendita include anche lo sconto fatto sull'ordine (es. arrotondamento in cassa), così il totale coincide con il totale ordine senza spedizione.
- Calcola il riepilogo giornaliero: Totale vendite IVA inclusa ed esclusa, Sconto confronto totale e medio, Sconti applicati Shopify, Totale merce, Totale spedizione, Numero vendite, Percentuale Online, Percentuale POS, Articoli venduti e Scontrino medio, più l'incasso per metodo di pagamento.
- Esporta un Excel stampabile in A4 orizzontale, con blocchi ordine che non vengono spezzati tra due pagine.
- Stampa bozza o stampa definitiva: la definitiva viene bloccata, inviata per email al gestore e stampata.

## Installazione
1. Installa Python 3.11+
2. Entra nella cartella del progetto
3. Installa dipendenze:

```bash
pip install -r requirements.txt
```

4. Copia `.env.example` in `.env` e inserisci i dati Shopify e, per la stampa definitiva, quelli email.

## Configurazione Shopify attuale
Le nuove app non si creano più da `Impostazioni > App e canali di vendita > Sviluppa app` nello Shopify Admin.
Bisogna creare l'app dalla Shopify Dev Dashboard o tramite Shopify CLI.

Per questo MVP usa una app Dev Dashboard installata sullo store e inserisci nel file `.env`:

```env
SHOPIFY_SHOP=tuo-negozio.myshopify.com
SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_CLIENT_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2026-07
# SHOP_NAME=Bottega Demo   # facoltativo: se omesso viene letto da Shopify
```

Il software usa il flusso `client_credentials`: quando parte, scambia `Client ID` e `Client Secret` con un access token temporaneo e lo usa per chiamare la GraphQL Admin API.

## Permessi Shopify necessari
Scope minimi consigliati:

- `read_orders`
- `read_products`
- `read_locations`, opzionale ma consigliato per Shopify POS / sedi

Shopify consente di default l'accesso agli ordini degli ultimi 60 giorni; per ordini più vecchi serve accesso esteso `read_all_orders`.

## Layout
Stesso design dell'app Shopify:

- titolo "Rapportino del venerdì 3 luglio 2026" con lo stato BOZZA o DEFINITIVO in alto a destra;
- nome del negozio, fuso orario e data di generazione sotto il titolo;
- sei riquadri: vendite IVA inclusa ed esclusa, sconto totale, numero vendite, scontrino medio e incasso contanti (vendite pagate solo in contanti);
- un blocco per ogni vendita con ora locale, canale e pagamento, righe prodotto e riga "Totale merce";
- riepilogo giornaliero nell'ordine originale e incasso per metodo di pagamento;
- foglio A4 orizzontale, piè di pagina con stato e numero di pagina.

## Uso
Genera la bozza del rapportino di oggi, senza stamparla:

```bash
python main.py
```

Genera e stampa la bozza di una data specifica (sulla carta compare "BOZZA" in alto su ogni pagina):

```bash
python main.py --date 2026-07-02 --stampa bozza
```

Stampa definitiva: chiude il giorno, invia il file al gestore e lo stampa:

```bash
python main.py --date 2026-07-02 --stampa definitiva
```

Le bozze vanno in `output/`, i definitivi in `output/definitivi/`, sempre dentro la cartella del progetto.

Il nome negozio viene preso automaticamente da Shopify (`shop.name`). Se vuoi forzarlo manualmente puoi usare `--shop-name "Bottega Demo"` oppure impostare `SHOP_NAME` nel file `.env`.

## Stampa definitiva
- Serve l'email del gestore nel `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` per la porta 465), `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` ed `EMAIL_GESTORE`. Senza questi dati il giorno non viene chiuso.
- Il file definitivo viene salvato una sola volta in `output/definitivi/`, con foglio e struttura protetti da password casuale non salvata e attributo di sola lettura. Il gestore riceve l'Excel in allegato con i numeri principali e l'impronta SHA-256 del file.
- `output/definitivi/registro.json` tiene data, impronta, operatore (utente di Windows), esito email e ore di stampa.
- Rilanciare `--stampa definitiva` sulla stessa data ristampa lo stesso file senza rigenerarlo e senza reinviare l'email. Se il file risulta modificato o rimosso, la ristampa viene rifiutata.
- Dopo la chiusura, bozze e nuove generazioni di quella data sono rifiutate.
- Se l'email non parte, il definitivo resta salvato: controlla la casella del gestore e rilancia lo stesso comando per ritentare invio e stampa.
- Errori temporanei di Shopify (rete, 429/5xx, limite di velocità) vengono ritentati fino a 4 volte prima di fermarsi con un messaggio.
- La stampa usa la stampante predefinita con il programma associato ai file Excel (`lp` fuori da Windows).

## Test

Dalla cartella dello script, senza chiamate reali a Shopify, email o stampante:

```bash
python -m unittest discover -s tests -v
```

Verificano omaggi e sconti sull'ordine, nuovi tentativi su errori temporanei e limite di velocità di Shopify, ordini con più di 100 righe e il flusso della stampa definitiva (registro, impronta SHA-256, email, ristampa).

## Nota importante
Il prezzo di listino usato nel rapportino è il `compareAtPrice` / prezzo di confronto Shopify. Se manca, il software usa il prezzo venduto e imposta sconto a zero.
