# Sicurezza e dipendenze, 27 settembre 2026

Aggiornamento del 28 settembre 2026: l'app è stata provata sullo store ed è in uso ogni giorno. Le segnalazioni sulle dipendenze descritte qui sotto restano aperte finché non si migra il framework.

Audit del 29 settembre 2026: `npm audit --omit=dev` riporta gli stessi 9 pacchetti; `npm audit fix` non propone correzioni compatibili (solo versioni precedenti di Remix, incompatibili). La soluzione resta la migrazione a React Router 7.

Dopo aggiornamenti e override testati, `npm audit --omit=dev` rileva 9 pacchetti segnalati (7 high, 2 moderate), dovuti a dipendenze condivise; non sono 9 vulnerabilità indipendenti. Audit completo: 10 pacchetti (8 high, 2 moderate), nessuno critical.

- `turbo-stream` 2.x, dipendenza Remix: [GHSA-rxv8-25v2-qmq8](https://github.com/advisories/GHSA-rxv8-25v2-qmq8). Il progetto disabilita `v3_singleFetch`; ciò non equivale a una certificazione di non sfruttabilità né rimuove la segnalazione.
- React Router 6.x, dipendenza Remix: [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg). Le versioni 6.30.6 sono fissate con override, ma non eliminano tutte le segnalazioni.

Non è stato imposto React Router 7/turbo-stream 3 tramite override incompatibili: serve una migrazione del framework con verifica di autenticazione, navigazione, SSR e risposte Shopify. `release:check` e `deploy` si fermano finché l'audit runtime non passa. Prima del rilascio ripetere l'audit: i conteggi possono cambiare con nuove advisory.

Altri aggiornamenti: Nodemailer 10, Vitest 4.1.11, Vite 6.4.3 e override di tar, uuid, deepmerge-ts, esbuild, toml ed estree-util-value-to-estree. I test/build locali passano con il lockfile consegnato; riesaminare gli override quando si aggiornano i pacchetti principali.

Controlli implementati: autenticazione SDK per ogni loader/API sensibile, bearer e Origin per le mutazioni, allowlist shop, scope di lettura, sessioni online per operatore, isolamento dati per shop ricavato dalla sessione, webhook verificati, assenza di secret nel client, destinatario email fisso, idempotenza uscite/email e importi in centesimi. L'idempotenza email non garantisce exactly-once quando SMTP ha un esito incerto; non ritentare alla cieca.

Destinazione: app privata per singolo commerciante. Non pronta per App Store pubblico: prima di una distribuzione pubblica occorrono flussi privacy/compliance, retention/cancellazione documentate e revisione completa. Non è implementata una chiusura fiscale o riconciliazione POS certificata.
