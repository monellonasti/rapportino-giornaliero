import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useRevalidator,
  useNavigation,
} from "@remix-run/react";
import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { config, requireAdmin } from "../shopify.server";
import { logError } from "../api.server";
import { UserError } from "../errors";
import { loadReport } from "../report.server";
import { emailStatusOf } from "../closures.server";
import { shortDate } from "../report";
import { ReportView } from "../components/ReportView";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireAdmin(request);
  const managerEmail = config.smtp?.manager ?? null;
  try {
    const report = await loadReport(
      admin,
      session.shop,
      new URL(request.url).searchParams.get("date"),
      config.cashGateways,
    );
    return {
      report,
      emailStatus:
        report.status === "definitivo"
          ? await emailStatusOf(session.shop, report.date)
          : null,
      emailEnabled: config.emailEnabled,
      managerEmail,
      error: null,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    // Motivi noti (data, valuta, limiti) all'operatore; il resto nei log del server.
    if (!(error instanceof UserError)) logError("app/rapportino", error);
    return {
      report: null,
      emailStatus: null,
      emailEnabled: config.emailEnabled,
      managerEmail,
      error:
        error instanceof UserError
          ? `Rapportino non disponibile: ${error.message}`
          : "Rapportino non disponibile. Verifica la data, i permessi ordini/prodotti e la connessione al database, poi riprova.",
    };
  }
}
export default function Rapportino() {
  const { report, emailStatus, emailEnabled, managerEmail, error } =
    useLoaderData<typeof loader>();
  const bridge = useAppBridge();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "ok" | "warn" | "error";
    text: string;
  } | null>(null);
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [emailId, setEmailId] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [printPending, setPrintPending] = useState(false);
  const closed = report?.status === "definitivo";
  const finalButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    setExpenseId(null);
    setEmailId(null);
    setCloseId(null);
    setConfirming(false);
    setPrintPending(false);
    setNotice(null);
  }, [report?.date]);
  // Dopo la chiusura si stampa la copia definitiva appena ricaricata; se il ricaricamento
  // fallisce la stampa non resta in sospeso per partire più tardi senza motivo.
  useEffect(() => {
    if (!printPending || revalidator.state !== "idle") return;
    if (closed) {
      setPrintPending(false);
      window.print();
    } else if (!report) setPrintPending(false);
  }, [printPending, closed, report, revalidator.state]);
  // Conferma della definitiva: il focus va sull'azione meno rischiosa e poi torna al pulsante.
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (wasConfirming.current) finalButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${await bridge.idToken()}`,
      },
    });
    if (!response.ok) {
      let message =
        "Operazione non riuscita; riapri l'app se la sessione è scaduta.";
      try {
        message = (await response.json()).error || message;
      } catch {}
      throw new Error(message);
    }
    return response;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({
        tone: "error",
        text: e instanceof Error ? e.message : "Errore",
      });
    } finally {
      setBusy(false);
    }
  }
  async function download(format: string) {
    if (!report) return;
    await run(async () => {
      const r = await call(`/api/export?date=${report.date}&format=${format}`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rapportino_${report.date}_${report.status}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }
  // Stampa definitiva: chiusura sul server, email al gestore, poi stampa.
  function closeDay(resend = false) {
    return run(async () => {
      const id = (!resend && closeId) || crypto.randomUUID();
      if (!resend) setCloseId(id);
      const response = await call("/api/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: report!.date, requestId: id, resend }),
      });
      const result: { created: boolean; emailStatus: string } =
        await response.json();
      setConfirming(false);
      setNotice(
        result.emailStatus === "sent"
          ? {
              tone: "ok",
              text: `Rapportino definitivo salvato e inviato al gestore (${managerEmail}).`,
            }
          : {
              tone: "warn",
              text: "Rapportino definitivo salvato, ma l'invio al gestore non è confermato: controlla la sua casella prima di reinviare.",
            },
      );
      if (!resend) setPrintPending(true);
      revalidator.revalidate();
    });
  }
  const loading = navigation.state !== "idle";
  const feedback = notice?.text || error;
  const feedbackTone = notice?.tone ?? "error";
  return (
    <main className="app">
      <header className="appbar no-print">
        <div className="appbar-title">
          <strong>Rapportino giornaliero</strong>
          <span>
            {report?.shopName || "Report vendite e movimenti di cassa"}
          </span>
        </div>
        <Form method="get" className="date-form">
          <label className="field">
            Data
            <input
              key={report?.date}
              type="date"
              name="date"
              defaultValue={report?.date}
              required
            />
          </label>
          <button className="btn btn-primary" disabled={busy || loading}>
            {loading ? "Caricamento…" : "Genera rapportino"}
          </button>
        </Form>
        <div className="appbar-actions" role="group" aria-label="Esporta">
          <button
            className="btn"
            disabled={!report || busy || loading}
            onClick={() => download("xlsx")}
          >
            Scarica Excel
          </button>
          <button
            className="btn"
            disabled={!report || busy || loading}
            onClick={() => download("pdf")}
          >
            Scarica PDF
          </button>
          <button
            className="btn"
            disabled={!report || busy || loading || !emailEnabled}
            title={
              emailEnabled
                ? "Invia al destinatario configurato"
                : "Configurare SMTP per abilitare"
            }
            onClick={() =>
              run(async () => {
                const id = emailId || crypto.randomUUID();
                setEmailId(id);
                await call("/api/email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ date: report!.date, requestId: id }),
                });
                // Inviata: un nuovo clic è una nuova richiesta, non un doppione.
                setEmailId(null);
                setNotice({
                  tone: "ok",
                  text: "Email accettata dal server SMTP.",
                });
              })
            }
          >
            Invia email
          </button>
          <button
            className="btn"
            disabled={!report || busy || loading || closed}
            title={
              closed
                ? "Il rapportino è definitivo: si stampa solo la copia definitiva"
                : "Stampa di controllo, senza chiudere il giorno"
            }
            onClick={() => window.print()}
          >
            Stampa bozza
          </button>
          {closed ? (
            <button
              className="btn btn-primary"
              disabled={busy || loading}
              onClick={() => window.print()}
            >
              Ristampa definitiva
            </button>
          ) : (
            <button
              ref={finalButton}
              className="btn btn-primary"
              disabled={!report || busy || loading || !emailEnabled}
              title={
                emailEnabled
                  ? "Chiude il rapportino e lo invia al gestore"
                  : "Configurare l'email del gestore (SMTP) per la stampa definitiva"
              }
              onClick={() => setConfirming(true)}
            >
              Stampa definitiva
            </button>
          )}
        </div>
      </header>
      {confirming && report && !closed && (
        <section
          className="confirm no-print"
          role="alertdialog"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-text"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setConfirming(false);
          }}
        >
          <h2 id="confirm-title">
            Stampa definitiva del {shortDate(report.date)}
          </h2>
          <p id="confirm-text">
            Il rapportino viene salvato così com'è e chiuso: vendite, pagamenti
            e uscite di questo giorno non potranno più essere modificati. Una
            copia in PDF ed Excel viene inviata al gestore ({managerEmail}).
          </p>
          <div className="confirm-actions">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => closeDay()}
            >
              Conferma e stampa
            </button>
            <button
              ref={cancelButton}
              className="btn"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Annulla
            </button>
          </div>
        </section>
      )}
      {feedback && (
        <p
          role={feedbackTone === "ok" ? "status" : "alert"}
          className={`notice no-print notice-${feedbackTone}`}
        >
          {feedback}
        </p>
      )}
      {closed && emailStatus && emailStatus !== "sent" && !notice && (
        <div className="notice notice-warn notice-row no-print" role="alert">
          <span>
            L'invio del rapportino definitivo al gestore non risulta confermato.
            Controlla la sua casella prima di reinviarlo.
          </span>
          <button
            className="btn"
            disabled={busy || !emailEnabled}
            onClick={() => closeDay(true)}
          >
            Reinvia al gestore
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="busy no-print">
          Operazione in corso…
        </p>
      )}
      {report && (
        <ReportView
          report={report}
          loading={loading}
          expenseForm={
            closed ? undefined : (
              <form
                className="expense-form no-print"
                // Dati cambiati dopo un errore: è una nuova richiesta, non la ripetizione della precedente.
                onInput={() => setExpenseId(null)}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  void run(async () => {
                    const body = new FormData(form);
                    body.set("date", report.date);
                    const id = expenseId || crypto.randomUUID();
                    setExpenseId(id);
                    body.set("requestId", id);
                    await call("/api/expenses", { method: "POST", body });
                    form.reset();
                    setExpenseId(null);
                    setNotice({ tone: "ok", text: "Uscita registrata." });
                    revalidator.revalidate();
                  });
                }}
              >
                <label className="field">
                  Importo EUR
                  <input
                    name="amount"
                    inputMode="decimal"
                    placeholder="35,00"
                    pattern="\d{1,7}([.,]\d{1,2})?"
                    title="Importo in euro con al massimo due decimali, es. 35,50"
                    required
                  />
                </label>
                <label className="field">
                  Causale
                  <input
                    name="reason"
                    maxLength={100}
                    placeholder="Corriere"
                    required
                  />
                </label>
                <label className="field field-wide">
                  Note
                  <input
                    name="note"
                    maxLength={500}
                    placeholder="Pagamento GLS"
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy || revalidator.state !== "idle"}
                >
                  Aggiungi uscita al {shortDate(report.date)}
                </button>
              </form>
            )
          }
        />
      )}
    </main>
  );
}
