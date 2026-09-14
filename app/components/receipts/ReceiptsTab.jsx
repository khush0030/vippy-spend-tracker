"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtINR, normalizeMerchant } from "../overview/aggregations";
import { cycleMilestones } from "@/lib/cycle-window";
import Icon from "../ui/Icon";
import { Banner, Button, Card, Chip, Empty, Kpi, Notice, Ring, Sheet } from "../ui/kit";

/**
 * The Receipts tab.
 *
 * Cycle-scoped, not period-scoped: the dashboard's date picker exists for
 * spend analysis, but a receipt belongs to whichever statement cycle will
 * claim it. The one number that matters is coverage — the share of chaseable
 * charges that have a bill against them — so it leads, and everything below
 * it explains where the gap is.
 */

const fmtDay = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countdown(days) {
  if (days == null) return "";
  if (days === 0) return "today";
  if (days > 0) return `in ${plural(days, "day")}`;
  return `${plural(Math.abs(days), "day")} ago`;
}

const RECEIPT_TONE = { matched: "ok", pending: null, unmatched: "warn", duplicate: null, rejected: "bad" };
const RECEIPT_LABEL = { matched: "Matched", pending: "Reading", unmatched: "No match yet", duplicate: "Duplicate", rejected: "Rejected" };
const SUBMISSION_TONE = { sent: "ok", failed: "bad", awaiting_approval: "warn", draft: null };
const SUBMISSION_LABEL = { sent: "Sent", failed: "Failed", awaiting_approval: "Awaiting approval", draft: "Draft" };
const LINE_TONE = { tied: "ok", created: "info", orphan: "warn", unexplained: "bad", unmatched: "warn" };
const LINE_LABEL = { tied: "Tied", created: "Added", orphan: "Orphan", unexplained: "Unexplained", unmatched: "Unmatched" };

export default function ReceiptsTab({ isMobile, onChanged }) {
  const [data, setData] = useState(null);
  const [statements, setStatements] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [openReceipt, setOpenReceipt] = useState(null);
  const [openStatement, setOpenStatement] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        fetch("/api/receipts").then((r) => r.json()),
        fetch("/api/statements").then((r) => r.json()),
        fetch("/api/submissions").then((r) => r.json()),
      ]);
      setData(a);
      setStatements(b?.statements || []);
      setSubmissions(c?.submissions || []);
    } catch (err) {
      setData({ error: err.message });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const milestones = useMemo(
    () => (data?.cycle ? cycleMilestones(data.cycle.end, data.cycle.submitDay, new Date()) : null),
    [data]
  );

  const rereconcile = async (statementId) => {
    setBusy(statementId);
    setMsg({ text: "", type: "" });
    try {
      const r = await fetch("/api/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementId }),
      });
      const out = await r.json();
      if (r.ok) {
        setMsg({ text: "Reconciled again against the current transactions.", type: "success" });
        await load();
        onChanged?.();
      } else {
        setMsg({ text: out.error || "Could not reconcile. Try again in a minute.", type: "error" });
      }
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
    setBusy("");
  };

  if (loading && !data) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 200 }} />
        <div className="grid grid-2"><div className="skeleton" style={{ height: 240 }} /><div className="skeleton" style={{ height: 240 }} /></div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="card">
        <Empty icon="alert" title="Could not load this cycle" action={<Button icon="sync" onClick={load}>Try again</Button>}>
          {data?.error || "The receipts service did not answer."}
        </Empty>
      </div>
    );
  }

  if (data.configured === false || !data.cycle) {
    return (
      <div className="card">
        <Empty icon="card" title="Set up your card first">
          Receipts are tracked per statement cycle. Add your statement day and accounts email in <b>Settings → Corporate card</b> and this page starts tracking.
        </Empty>
      </div>
    );
  }

  const coverage = data.coverage;
  const statement = statements[0] || null;

  return (
    <div className="stack">
      <Notice msg={msg} />

      <CycleCard cycle={data.cycle} coverage={coverage} milestones={milestones} isMobile={isMobile} />

      <div className="grid grid-main">
        <div className="stack">
          <OutstandingCard rows={data.outstanding} minAmount={data.cycle?.minReceiptAmount} />
          <ReceiptListCard receipts={data.receipts} onOpen={setOpenReceipt} />
        </div>
        <div className="stack">
          <StatementCard statement={statement} busy={busy} onReconcile={rereconcile} onOpen={() => setOpenStatement(statement)} />
          <SubmissionsCard submissions={submissions} />
        </div>
      </div>

      <ReceiptSheet receipt={openReceipt} onClose={() => setOpenReceipt(null)} />
      <StatementSheet statement={openStatement} onClose={() => setOpenStatement(null)} />
    </div>
  );
}

// ── The cycle in flight ──
function CycleCard({ cycle, coverage, milestones, isMobile }) {
  const pct = coverage?.coveragePct ?? 100;
  const tone = pct >= 90 ? "var(--success)" : pct >= 70 ? "var(--warning)" : "var(--danger)";

  return (
    <Card padLg>
      <div style={{ display: "flex", gap: isMobile ? 16 : 28, alignItems: "center", flexWrap: "wrap" }}>
        <Ring pct={pct} size={isMobile ? 96 : 112} stroke={isMobile ? 9 : 11} color={tone}>
          <div>
            <div className="num" style={{ fontSize: isMobile ? 22 : 26, fontWeight: 600, letterSpacing: "-0.03em" }}>{pct}%</div>
            <div className="label" style={{ fontSize: 9.5 }}>covered</div>
          </div>
        </Ring>

        <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.01em" }}>
              Cycle <span className="num">{fmtDay(cycle.start)} – {fmtDay(cycle.end)}</span>
            </span>
            <Chip tone="brand">{cycle.status}</Chip>
          </div>
          <div className="kpi-row">
            <Kpi label="Charges" value={coverage?.txnCount ?? 0} sub={fmtINR(coverage?.total ?? 0)} />
            <Kpi label="Need receipt" value={coverage?.chaseable ?? 0} />
            <Kpi label="Have receipt" value={coverage?.withReceipt ?? 0} tone="var(--success)" />
            <Kpi label="Missing" value={coverage?.missing ?? 0} tone={coverage?.missing ? "var(--danger)" : undefined} />
          </div>
        </div>
      </div>

      {milestones && <CycleTimeline cycle={cycle} milestones={milestones} />}

      {!cycle.accountsEmail?.length && (
        <div style={{ marginTop: 14 }}>
          <Banner title="No accounts email set">The package has nowhere to go. Add one in Settings → Corporate card.</Banner>
        </div>
      )}
    </Card>
  );
}

/** Cycle start → statement → submit, with today placed on the line. */
function CycleTimeline({ cycle, milestones }) {
  const t = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime();
  const start = t(cycle.start);
  const end = t(milestones.submitDate);
  const span = Math.max(1, end - start);
  const pos = (iso) => Math.max(0, Math.min(100, ((t(iso) - start) / span) * 100));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayPct = Math.max(0, Math.min(100, ((today.getTime() - start) / span) * 100));
  const stops = [
    { key: "start", at: 0, label: "Cycle opened", date: cycle.start, sub: "" },
    { key: "stmt", at: pos(milestones.statementDate), label: "Statement", date: milestones.statementDate, sub: countdown(milestones.daysToStatement) },
    { key: "submit", at: 100, label: "Package to accounts", date: milestones.submitDate, sub: countdown(milestones.daysToSubmit) },
  ];
  return (
    <div style={{ marginTop: 22 }} aria-label="Cycle timeline">
      <div style={{ position: "relative", height: 16, margin: "0 8px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 7, height: 2, background: "var(--border)" }} />
        <div style={{ position: "absolute", left: 0, width: `${todayPct}%`, top: 7, height: 2, background: "var(--brand)" }} />
        {stops.map((s) => (
          <span key={s.key} style={{ position: "absolute", left: `${s.at}%`, top: 3, width: 10, height: 10, transform: "translateX(-50%)", borderRadius: "50%", background: todayPct >= s.at ? "var(--brand)" : "var(--bg-card)", border: "2px solid var(--brand)" }} />
        ))}
        {todayPct > 0 && todayPct < 100 && (
          <span title="Today" style={{ position: "absolute", left: `${todayPct}%`, top: -2, width: 2, height: 20, transform: "translateX(-50%)", background: "var(--text)", borderRadius: 1 }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
        {stops.map((s, i) => (
          <div key={s.key} style={{ textAlign: i === 0 ? "left" : i === stops.length - 1 ? "right" : "center", minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 600 }}>{s.label}</div>
            <div className="small muted num">{fmtDay(s.date)}{s.sub ? ` · ${s.sub}` : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── What still needs a bill ──
function OutstandingCard({ rows, minAmount }) {
  return (
    <Card title="Needs a receipt" hint={rows?.length ? `${plural(rows.length, "charge")} · largest first` : null} flush>
      {!rows?.length ? (
        <Empty icon="checkCircle" title="All caught up">
          Every charge above {fmtINR(minAmount ?? 500)} has a receipt.
        </Empty>
      ) : (
        <>
          <div>
            {rows.map((t) => (
              <div key={t.id} className="list-row">
                <span className="merchant-avatar" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}><Icon name="receipt" size={16} /></span>
                <span className="grow">
                  <div className="title">{normalizeMerchant(t.merchant)}</div>
                  <div className="meta">{fmtDay(t.date)}</div>
                </span>
                <span className="amt">{fmtINR(t.amount)}</span>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
            <Icon name="bot" size={15} />
            Send a photo or PDF of the bill to the Telegram bot. Charges under {fmtINR(minAmount ?? 500)} are waived.
          </div>
        </>
      )}
    </Card>
  );
}

// ── Bills that have come in ──
function ReceiptListCard({ receipts, onOpen }) {
  return (
    <Card title="Receipts received" hint={receipts?.length ? `${receipts.length} this cycle` : null} flush>
      {!receipts?.length ? (
        <Empty icon="image" title="No receipts yet">Send a photo of a bill to the Telegram bot and it appears here, matched to its charge.</Empty>
      ) : (
        <div>
          {receipts.map((r) => {
            const foreign = r.currency && r.currency !== "INR";
            return (
              <button key={r.id} className="list-row" onClick={() => onOpen(r)}>
                <span className="merchant-avatar" style={{ background: "var(--bg-card-2)", color: "var(--text-muted)" }}>
                  <Icon name={r.doc_type === "invoice" ? "file" : "image"} size={16} />
                </span>
                <span className="grow">
                  <div className="title">{r.merchant || "Still reading…"}</div>
                  <div className="meta">
                    {fmtDay(r.receipt_date || r.created_at)}
                    {r.match?.transaction ? ` · matched to ${fmtINR(r.match.transaction.amount)} on ${fmtDay(r.match.transaction.date)}` : ""}
                    {r.country && r.country !== "IN" ? ` · ${r.country}` : ""}
                  </div>
                </span>
                <Chip tone={RECEIPT_TONE[r.status]}>{RECEIPT_LABEL[r.status] || r.status}</Chip>
                <span className="amt" style={{ minWidth: 80 }}>{r.amount == null ? "—" : foreign ? `${r.currency} ${Number(r.amount).toFixed(2)}` : fmtINR(r.amount)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function isPdf(mime, url) {
  return (mime || "").includes("pdf") || /\.pdf(\?|$)/i.test(url || "");
}

function DocPreview({ url, mime, title, loading }) {
  if (loading) return <div className="doc-frame skeleton" style={{ height: 320 }} />;
  if (!url) {
    return (
      <div className="doc-frame" style={{ height: 160 }}>
        <span className="small muted">The stored file could not be read.</span>
      </div>
    );
  }
  return (
    <div className="doc-frame">
      {isPdf(mime, url) ? <iframe src={url} title={title} /> : <img src={url} alt={title} />}
    </div>
  );
}

function ReceiptSheet({ receipt, onClose }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (!receipt) return;
    setDetail(null);
    fetch(`/api/receipts?id=${receipt.id}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail({ url: null }));
  }, [receipt]);
  const close = useCallback(() => onClose(), [onClose]);
  if (!receipt) return null;
  const r = { ...receipt, ...(detail?.receipt || {}) };
  const foreign = r.currency && r.currency !== "INR";

  return (
    <Sheet open onClose={close} wide title={r.merchant || "Receipt"} subtitle={fmtDay(r.receipt_date || r.created_at)} labelledBy="receipt-title"
      leading={<span className="merchant-avatar" style={{ background: "var(--bg-card-2)", color: "var(--text-muted)" }}><Icon name="receipt" size={16} /></span>}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 18 }} className="receipt-grid">
        <div className="stack" style={{ gap: 8 }}>
          <DocPreview url={detail?.url} mime={r.mime} title={r.merchant || "Receipt"} loading={!detail} />
          {detail?.url && (
            <a className="btn sm" href={detail.url} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
              <Icon name="external" size={14} /> Open full size
            </a>
          )}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
              {foreign ? `${r.currency} ${Number(r.amount || 0).toFixed(2)}` : fmtINR(r.amount)}
            </span>
            <Chip tone={RECEIPT_TONE[r.status]}>{RECEIPT_LABEL[r.status] || r.status}</Chip>
          </div>
          {foreign && r.amount_inr && <div className="small muted">≈ {fmtINR(r.amount_inr)} at posting</div>}

          {r.match?.transaction ? (
            <Banner tone="ok" icon="link" title={`Matched to ${normalizeMerchant(r.match.transaction.merchant)}`}>
              {fmtINR(r.match.transaction.amount)} on {fmtDay(r.match.transaction.date)}
              {r.match.match_score != null ? ` · score ${r.match.match_score}` : ""}
            </Banner>
          ) : (
            <Banner icon="link" title="Not matched to a charge yet">It binds automatically once the charge syncs from Gmail.</Banner>
          )}

          <dl className="kv-list">
            {r.doc_type && <div><dt>Document</dt><dd style={{ textTransform: "capitalize" }}>{r.doc_type}</dd></div>}
            {r.country && <div><dt>Country</dt><dd>{r.country}</dd></div>}
            <div><dt>Read by</dt><dd>{r.consensus || "—"}</dd></div>
            {r.confidence != null && (
              <div>
                <dt>Confidence</dt>
                <dd style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                  <span className="bar-track" style={{ width: 80 }}><span className="bar-fill" style={{ display: "block", width: `${Math.round(Number(r.confidence) * 100)}%` }} /></span>
                  <span className="num">{Number(r.confidence).toFixed(2)}</span>
                </dd>
              </div>
            )}
            <div><dt>Received</dt><dd className="num">{r.created_at ? new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div>
          </dl>
        </div>
      </div>
    </Sheet>
  );
}

// ── The bank's own ledger ──
function StatementCard({ statement, busy, onReconcile, onOpen }) {
  if (!statement) {
    return (
      <Card title="Statement">
        <Empty icon="file" title="No statement read yet">
          HDFC's statement is picked up from Gmail on the statement day — nothing to forward.
        </Empty>
      </Card>
    );
  }

  const diff = Number(statement.tie_out_diff ?? 0);
  const tiesOut = statement.status === "reconciled" && Math.abs(diff) <= 0.5;
  const debits = Number(statement.total_debits || 0);
  const credits = Number(statement.total_credits || 0);
  const flowMax = Math.max(debits, credits, 1);

  return (
    <Card title="Statement" hint={`issued ${fmtDay(statement.issued_on)}`} action={<Chip tone={tiesOut ? "ok" : "bad"}>{tiesOut ? "Ties out" : `Off by ${fmtINR(Math.abs(diff))}`}</Chip>}>
      <div className="small muted num" style={{ marginBottom: 12 }}>{fmtDay(statement.period_start)} – {fmtDay(statement.period_end)}</div>

      <div className="grid grid-2" style={{ gap: 12 }}>
        <Kpi label="Opening" value={statement.opening_balance == null ? "—" : fmtINR(statement.opening_balance)} />
        <Kpi label="Closing" value={statement.closing_balance == null ? "—" : fmtINR(statement.closing_balance)} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {[["Debits", debits, "var(--danger)"], ["Credits", credits, "var(--success)"]].map(([label, v, c]) => (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) auto", gap: 10, alignItems: "center", fontSize: 12.5 }}>
            <span className="muted">{label}</span>
            <span className="bar-track"><span className="bar-fill" style={{ display: "block", width: `${(v / flowMax) * 100}%`, background: c }} /></span>
            <span className="num">{fmtINR(v)}</span>
          </div>
        ))}
      </div>

      {!tiesOut && (
        <p className="small" style={{ color: "var(--danger)", marginTop: 12 }}>This cycle can't be submitted until the difference is explained.</p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Button variant="primary" icon="file" onClick={onOpen}>View statement</Button>
        <Button icon="sync" onClick={() => onReconcile(statement.id)} disabled={busy === statement.id} title="Re-runs the match against current transactions. No model call, no cost.">
          {busy === statement.id ? "Reconciling…" : "Reconcile again"}
        </Button>
      </div>
    </Card>
  );
}

function StatementSheet({ statement, onClose }) {
  const [detail, setDetail] = useState(null);
  const [view, setView] = useState("lines");
  useEffect(() => {
    if (!statement) return;
    setDetail(null);
    setView("lines");
    fetch(`/api/statements?id=${statement.id}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail({ lines: [], url: null }));
  }, [statement]);
  const close = useCallback(() => onClose(), [onClose]);
  if (!statement) return null;

  const lines = detail?.lines || [];
  const counts = lines.reduce((m, l) => ((m[l.recon_status] = (m[l.recon_status] || 0) + 1), m), {});

  return (
    <Sheet open onClose={close} wide title="HDFC statement" subtitle={`${fmtDay(statement.period_start)} – ${fmtDay(statement.period_end)} · issued ${fmtDay(statement.issued_on)}`} labelledBy="statement-title"
      leading={<span className="merchant-avatar" style={{ background: "var(--brand-subtle)", color: "var(--brand-strong-text)" }}><Icon name="file" size={16} /></span>}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="seg" role="tablist">
          <button className={view === "lines" ? "on" : ""} onClick={() => setView("lines")} role="tab" aria-selected={view === "lines"}>Reconciliation</button>
          <button className={view === "pdf" ? "on" : ""} onClick={() => setView("pdf")} role="tab" aria-selected={view === "pdf"}>PDF</button>
        </div>
        {detail?.url && (
          <a className="btn sm" href={detail.url} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>
            <Icon name="download" size={14} /> Download PDF
          </a>
        )}
      </div>

      {view === "pdf" ? (
        <DocPreview url={detail?.url} mime="application/pdf" title="Statement PDF" loading={!detail} />
      ) : !detail ? (
        <div className="skeleton" style={{ height: 280 }} />
      ) : lines.length === 0 ? (
        <Empty icon="file" title="No lines on file">The statement was stored but its lines haven't been read.</Empty>
      ) : (
        <>
          <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", background: "var(--bg-card-2)" }} aria-label="Reconciliation outcome by line">
            {Object.entries(counts).map(([k, n]) => (
              <span key={k} title={`${LINE_LABEL[k] || k}: ${n}`} style={{ width: `${(n / lines.length) * 100}%`, background: `var(--${LINE_TONE[k] === "ok" ? "success" : LINE_TONE[k] === "bad" ? "danger" : LINE_TONE[k] === "info" ? "info" : "warning"})` }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(counts).map(([k, n]) => <Chip key={k} tone={LINE_TONE[k]}>{LINE_LABEL[k] || k} · {n}</Chip>)}
          </div>
          <div className="card flush table-wrap">
            <table className="data">
              <thead><tr><th className="hide-mobile">Date</th><th>Description</th><th className="r">Amount</th><th className="r hide-mobile">Status</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="num muted hide-mobile">{fmtDay(l.txn_date)}</td>
                    <td style={{ maxWidth: 320, minWidth: 0 }}>
                      <div style={{ overflowWrap: "anywhere" }}>{l.descriptor}</div>
                      <div className="small muted">
                        <span className="show-mobile num">{fmtDay(l.txn_date)} · </span>
                        {l.type !== "purchase" ? l.type : ""}{l.currency ? ` ${l.currency} ${l.amount_orig}` : ""}
                      </div>
                    </td>
                    <td className="r num" style={{ color: l.direction === "credit" ? "var(--success)" : undefined }}>
                      {l.direction === "credit" ? "+" : ""}{fmtINR(l.amount)}
                      <div className="show-mobile" style={{ marginTop: 4 }}><Chip tone={LINE_TONE[l.recon_status]}>{LINE_LABEL[l.recon_status] || l.recon_status}</Chip></div>
                    </td>
                    <td className="r hide-mobile"><Chip tone={LINE_TONE[l.recon_status]}>{LINE_LABEL[l.recon_status] || l.recon_status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ── What has gone to accounts ──
function SubmissionsCard({ submissions }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const download = async (id) => {
    setBusy(id);
    setErr("");
    try {
      const r = await fetch(`/api/submissions?id=${id}`);
      const out = await r.json();
      if (!r.ok || !out.url) throw new Error(out.error || "The package could not be downloaded");
      window.location.href = out.url;
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  return (
    <Card title="Packages to accounts" flush>
      {!submissions?.length ? (
        <Empty icon="send" title="Nothing sent yet">
          The package — receipts plus a summary — is built on the submit day and waits for your approval. Nothing is mailed automatically.
        </Empty>
      ) : (
        <div>
          {submissions.map((s) => (
            <div key={s.id} className="list-row" style={{ flexWrap: "wrap" }}>
              <span className="merchant-avatar" style={{ background: "var(--bg-card-2)", color: "var(--text-muted)" }}><Icon name="send" size={15} /></span>
              <span className="grow">
                <div className="title">{fmtDay(s.created_at)} · <span className="num">{fmtINR(s.total_amount)}</span></div>
                <div className="meta">{plural(s.line_count ?? 0, "line")} · {plural(s.receipt_count ?? 0, "receipt")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                  <span className="bar-track" style={{ flex: 1, maxWidth: 140, height: 5 }}><span className="bar-fill" style={{ display: "block", width: `${s.coverage_pct ?? 0}%` }} /></span>
                  <span className="num small muted">{s.coverage_pct ?? 0}% covered</span>
                </div>
              </span>
              <Chip tone={SUBMISSION_TONE[s.status]}>{SUBMISSION_LABEL[s.status] || s.status}</Chip>
              {s.zip_path && (
                <Button size="sm" icon="download" onClick={() => download(s.id)} disabled={busy === s.id} aria-label="Download package">
                  {busy === s.id ? "…" : "ZIP"}
                </Button>
              )}
            </div>
          ))}
          {err && <div className="small" style={{ color: "var(--danger)", padding: "8px 16px" }}>{err}</div>}
        </div>
      )}
    </Card>
  );
}
