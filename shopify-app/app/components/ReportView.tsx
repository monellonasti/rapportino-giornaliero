import type { ReactNode } from "react";
import {
  displayMetric,
  euro,
  generatedLabel,
  percent,
  plural,
  statusLabel,
  timeOf,
  type Report,
  type ReportOrder,
} from "../report";

const Nil = () => <span className="nil">–</span>;

function OrderCard({ order: o }: { order: ReportOrder }) {
  // Voci che riconciliano la merce con il totale dell'ordine.
  const extra: [string, number][] = [];
  if (o.shipping) extra.push(["Spedizione", o.shipping]);
  if (o.other) extra.push(["Altre voci dell'ordine", o.other]);
  return (
    <article className="order">
      <header className="order-head">
        <div className="order-id">
          <strong>{o.name}</strong>
          <span className="order-time">{o.time}</span>
          <span className="tag">{o.channel}</span>
          <span className="tag">{o.payment}</span>
        </div>
        <p className="order-total">
          <span>Totale ordine</span> <strong>{euro(o.total)}</strong>
        </p>
      </header>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th scope="col">Prodotto</th>
              <th scope="col" className="num">
                Q.tà
              </th>
              <th scope="col" className="num">
                Prezzo confronto
              </th>
              <th scope="col" className="num">
                Prezzo vendita
              </th>
              <th scope="col" className="num">
                Sconto €
              </th>
              <th scope="col" className="num">
                Sconto %
              </th>
              <th scope="col" className="num">
                Totale
              </th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l, i) => (
              <tr key={i}>
                <td className="product">{l.name}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{euro(l.compare)}</td>
                <td className="num">{euro(l.sold)}</td>
                <td className="num">
                  {l.discount ? euro(l.discount) : <Nil />}
                </td>
                <td className="num">
                  {l.discount ? percent(l.discountPercent) : <Nil />}
                </td>
                <td className="num total">{euro(l.total)}</td>
              </tr>
            ))}
          </tbody>
          {(o.lines.length > 1 ||
            o.orderDiscount !== 0 ||
            extra.length > 0) && (
            <tfoot>
              {(o.lines.length > 1 || o.orderDiscount !== 0) && (
                <tr className="subtotal">
                  <th scope="row">
                    Totale merce
                    {o.orderDiscount !== 0 && (
                      <span className="subtotal-note">
                        incl. sconto ordine {euro(o.orderDiscount)}
                      </span>
                    )}
                  </th>
                  <td className="num">{o.items}</td>
                  <td />
                  <td />
                  <td className="num">
                    {o.discount ? euro(o.discount) : <Nil />}
                  </td>
                  <td className="num">
                    {o.discount ? percent(o.discountPercent) : <Nil />}
                  </td>
                  <td className="num total">{euro(o.merchandise)}</td>
                </tr>
              )}
              {extra.map(([label, value]) => (
                <tr className="extra" key={label}>
                  <th scope="row" colSpan={6}>
                    {label}
                  </th>
                  <td className="num total">{euro(value)}</td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

export function ReportView({
  report,
  expenseForm,
  loading = false,
}: {
  report: Report;
  expenseForm?: ReactNode;
  loading?: boolean;
}) {
  const sales = report.summary.filter((m) => m.group === "vendite");
  const items = report.orders.reduce((n, o) => n + o.items, 0);
  const final = report.status === "definitivo";
  return (
    <article
      className={loading ? "report is-loading" : "report"}
      data-status={report.status}
    >
      {!final && (
        <div className="watermark" aria-hidden="true">
          BOZZA
        </div>
      )}
      <header className="report-header">
        <div>
          <p className="eyebrow">
            Rapportino giornaliero
            <span className={final ? "status status-final" : "status"}>
              {final ? "Definitivo" : "Bozza"}
            </span>
          </p>
          <h1>{report.title}</h1>
          <p className="report-shop">{report.shopName}</p>
          <p className="report-status">
            {statusLabel(report)}
            {report.closedBy && ` · operatore ${report.closedBy}`}
          </p>
        </div>
        <dl className="report-meta">
          <div>
            <dt>Fuso orario</dt>
            <dd>{report.timezone}</dd>
          </div>
          <div>
            <dt>Sedi</dt>
            <dd>Tutte</dd>
          </div>
          <div>
            <dt>Valuta</dt>
            <dd>{report.currency}</dd>
          </div>
          <div>
            <dt>Generato</dt>
            <dd>{generatedLabel(report)}</dd>
          </div>
        </dl>
      </header>

      <section className="kpis" aria-label="Indicatori principali">
        {report.kpis.map((k) => (
          <div
            key={k.label}
            className={k.highlight ? "kpi kpi-highlight" : "kpi"}
          >
            <span className="kpi-label">{k.label}</span>
            <strong className="kpi-value">{displayMetric(k)}</strong>
            <span className="kpi-hint">{k.hint}</span>
          </div>
        ))}
      </section>

      <section className="section" aria-labelledby="dettaglio-vendite">
        <header className="section-head">
          <h2 id="dettaglio-vendite">Dettaglio vendite</h2>
          <p>
            {plural(report.orders.length, "vendita", "vendite")} ·{" "}
            {plural(items, "articolo", "articoli")}
          </p>
        </header>
        {report.orders.length ? (
          report.orders.map((o) => <OrderCard key={o.id} order={o} />)
        ) : (
          <p className="empty">Nessuna vendita nella data scelta.</p>
        )}
      </section>

      <section className="section" aria-labelledby="riepilogo">
        <header className="section-head">
          <h2 id="riepilogo">Riepilogo giornaliero</h2>
        </header>
        <div className="recap">
          <div className="panel">
            <h3>Vendite</h3>
            <dl className="rows">
              {sales.map((m) => (
                <div key={m.label} className={m.strong ? "strong" : undefined}>
                  <dt>{m.label}</dt>
                  <dd>{displayMetric(m)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="recap-side">
            <div className="panel">
              <h3>Pagamenti del giorno</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th scope="col">Metodo</th>
                    <th scope="col" className="num">
                      Incassi
                    </th>
                    <th scope="col" className="num">
                      Rimborsi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.payments.map((p) => (
                    <tr key={p.gateway}>
                      <td>
                        {p.label}
                        {p.label.toLowerCase() !== p.gateway && (
                          <span className="gateway">{p.gateway}</span>
                        )}
                      </td>
                      <td className="num">{euro(p.receipts)}</td>
                      <td className="num">
                        {p.refunds ? euro(p.refunds) : <Nil />}
                      </td>
                    </tr>
                  ))}
                  {!report.payments.length && (
                    <tr>
                      <td colSpan={3} className="nil">
                        Nessun movimento nel giorno
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Totale</th>
                    <td className="num">{euro(report.receiptsTotal)}</td>
                    <td className="num">
                      {report.refundsTotal ? (
                        euro(report.refundsTotal)
                      ) : (
                        <Nil />
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="panel">
              <h3>Cassa contanti</h3>
              <dl className="rows">
                <div>
                  <dt>Contanti incassati</dt>
                  <dd>{euro(report.cashReceipts)}</dd>
                </div>
                <div>
                  <dt>Rimborsi contanti</dt>
                  <dd>{euro(-report.cashRefunds)}</dd>
                </div>
                <div>
                  <dt>Uscite di cassa</dt>
                  <dd>{euro(-report.expensesTotal)}</dd>
                </div>
              </dl>
              <p className="cash-total">
                <span>Contanti attesi</span>
                <strong>{euro(report.cashExpected)}</strong>
              </p>
              <p className="panel-note">
                Senza fondo cassa iniziale, versamenti e trasferimenti.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="uscite">
        <header className="section-head">
          <h2 id="uscite">Uscite di cassa</h2>
          {report.expenses.length > 0 && (
            <p>
              {plural(report.expenses.length, "uscita", "uscite")} ·{" "}
              {euro(report.expensesTotal)}
            </p>
          )}
        </header>
        {final ? (
          <p className="closed-note no-print">
            Rapportino definitivo: le uscite di questo giorno non sono più
            modificabili.
          </p>
        ) : (
          expenseForm
        )}
        {report.expenses.length ? (
          <div className="table-wrap">
            <table className="compact expenses">
              <thead>
                <tr>
                  <th scope="col">Ora</th>
                  <th scope="col">Causale</th>
                  <th scope="col">Note</th>
                  <th scope="col">Operatore ID</th>
                  <th scope="col" className="num">
                    Importo
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="num-left">
                      {timeOf(e.createdAt, report.timezone)}
                    </td>
                    <td className="strong">{e.reason}</td>
                    <td>{e.note}</td>
                    <td className="muted">{e.operatorId}</td>
                    <td className="num strong">{euro(e.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>
                    Totale uscite
                  </th>
                  <td className="num">{euro(report.expensesTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="empty">Nessuna uscita registrata per questa data.</p>
        )}
      </section>

      <footer className="notes">
        <h2>Note di lettura</h2>
        <ul>
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </footer>
    </article>
  );
}
