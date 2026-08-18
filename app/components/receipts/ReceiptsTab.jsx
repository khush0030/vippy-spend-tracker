"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtINR } from "../overview/aggregations";
import { cycleMilestones } from "@/lib/cycle-window";

/**
 * The Receipts tab.
 *
 * Cycle-scoped, not period-scoped: the dashboard's date picker exists for
 * spend analysis, but a receipt belongs to whichever statement cycle will
 * claim it, and that boundary is the 18th. The one number that matters is
 * coverage — the share of chaseable charges that have a bill against them —
 * so it leads, and everything below it explains where the gap is.
 */

const numStyle = {
  fontFamily: "var(--font-display)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 14,
  fontFamily: "var(--font-display)",
};

const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 22,
};

const rowStyle = {
  display: "flex",
  alignItems: "baseline",
  gap: 12,
  padding: "10px 0",
  borderBottom: "1px solid var(--border)",
  fontSize: 13,
};

const mutedStyle = { fontSize: 12, color: "var(--text-muted)" };

const fmtDay = (iso) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })
    : "—";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countdown(days, label) {
  if (days == null) return null;
  if (days === 0) return `${label} today`;
  if (days > 0) return `${label} in ${plural(days, "day")}`;
  return `${label} was ${plural(Math.abs(days), "day")} ago`;
}

export default function ReceiptsTab({ isMobile }) {
  const [data, setData] = useState(null);
  const [statements, setStatements] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "" });

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
    () =>
      data?.cycle ? cycleMilestones(data.cycle.end, data.cycle.submitDay, new Date()) : null,
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
      } else {
        setMsg({ text: out.error || "Could not reconcile", type: "error" });
      }
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
    setBusy("");
  };

  if (loading) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading the cycle…</div>;
  }

  // Anything short of a usable payload gets its own state. Without this the
  // cycle card would dereference a cycle that never arrived.
  if (!data || data.error) {
    return (
      <div style={{ ...cardStyle, maxWidth: 620 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          Could not load the cycle
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>
          {data?.error || "The receipts endpoint did not answer."}
        </div>
        <button
          onClick={load}
          style={{
            padding: "9px 16px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-card-2)",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "var(--font-display)",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (data.configured === false || !data.cycle) {
    return (
      <div style={{ ...cardStyle, maxWidth: 620 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          No card configured yet
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Receipt Rail needs to know when your statement is issued and where the package goes.
          Fill in <strong>Settings → Corporate Card</strong> and this tab will start tracking the
          cycle.
        </div>
      </div>
    );
  }

  const coverage = data?.coverage;
  const statement = statements[0] || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, maxWidth: 900 }}>
      {msg.text && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: msg.type === "error" ? "var(--danger)" : "var(--success)",
          }}
        >
          {msg.text}
        </div>
      )}

      <CycleCard
        cycle={data.cycle}
        coverage={coverage}
        milestones={milestones}
        isMobile={isMobile}
      />

      <StatementCard
        statement={statement}
        busy={busy}
        onReconcile={rereconcile}
      />

      <OutstandingCard rows={data.outstanding} minAmount={data.cycle?.minReceiptAmount} />

      <ReceiptListCard receipts={data.receipts} />

      <SubmissionsCard submissions={submissions} />
    </div>
  );
}

// ── The cycle in flight ──
function CycleCard({ cycle, coverage, milestones, isMobile }) {
  const pct = coverage?.coveragePct ?? 100;
  const tone = pct >= 90 ? "var(--success)" : pct >= 70 ? "var(--text)" : "var(--danger)";

  return (
    <section>
      <h2 style={sectionLabelStyle}>Cycle in flight</h2>
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: isMobile ? 20 : 40,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ ...numStyle, fontSize: 52, fontWeight: 800, color: tone, lineHeight: 1 }}>
              {pct}%
            </div>
            <div style={{ ...mutedStyle, marginTop: 6 }}>coverage</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <div>
              <span style={numStyle}>{fmtDay(cycle.start)}</span> →{" "}
              <span style={numStyle}>{fmtDay(cycle.end)}</span>
              <span style={mutedStyle}> · {cycle.status}</span>
            </div>
            <div style={mutedStyle}>
              {coverage?.chaseable ?? 0} chaseable · {coverage?.withReceipt ?? 0} receipted ·{" "}
              <strong style={{ color: coverage?.missing ? "var(--danger)" : "var(--text-muted)" }}>
                {coverage?.missing ?? 0} missing
              </strong>
            </div>
            <div style={mutedStyle}>
              {plural(coverage?.txnCount ?? 0, "charge")} · {fmtINR(coverage?.total ?? 0)}
            </div>
          </div>

          {milestones && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <div>
                📄 {countdown(milestones.daysToStatement, "Statement")}
                <span style={mutedStyle}> · {fmtDay(milestones.statementDate)}</span>
              </div>
              <div>
                📦 {countdown(milestones.daysToSubmit, "Package")}
                <span style={mutedStyle}> · {fmtDay(milestones.submitDate)}</span>
              </div>
              <div style={mutedStyle}>
                {cycle.accountsEmail?.length
                  ? `→ ${cycle.accountsEmail.join(", ")}`
                  : "⚠️ no accounts email set"}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--bg-card-2)",
            marginTop: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${pct}%`, height: "100%", background: tone, transition: "width 0.3s" }} />
        </div>
      </div>
    </section>
  );
}

// ── The bank's own ledger ──
function StatementCard({ statement, busy, onReconcile }) {
  if (!statement) {
    return (
      <section>
        <h2 style={sectionLabelStyle}>Statement</h2>
        <div style={{ ...cardStyle, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          No statement has been read yet. HDFC issues it on the statement day and it is picked up
          from Gmail automatically — nothing to forward.
        </div>
      </section>
    );
  }

  const diff = Number(statement.tie_out_diff ?? 0);
  const tiesOut = statement.status === "reconciled" && Math.abs(diff) <= 0.5;

  return (
    <section>
      <h2 style={sectionLabelStyle}>Statement</h2>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800 }}>
              Issued {fmtDay(statement.issued_on)}
            </div>
            <div style={{ ...mutedStyle, marginTop: 4 }}>
              {fmtDay(statement.period_start)} → {fmtDay(statement.period_end)} · {statement.status}
            </div>
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: tiesOut ? "var(--success)" : "var(--danger)",
              textAlign: "right",
            }}
          >
            {tiesOut ? "Ties out ✅" : `Off by ${fmtINR(Math.abs(diff))} ⛔`}
            {!tiesOut && (
              <div style={{ ...mutedStyle, fontWeight: 500, marginTop: 4, maxWidth: 280 }}>
                The cycle cannot be submitted until this is explained.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 28, marginTop: 18, flexWrap: "wrap", fontSize: 13 }}>
          <Figure label="Opening" value={statement.opening_balance} />
          <Figure label="Debits" value={statement.total_debits} />
          <Figure label="Credits" value={statement.total_credits} />
          <Figure label="Closing" value={statement.closing_balance} />
        </div>

        <button
          onClick={() => onReconcile(statement.id)}
          disabled={busy === statement.id}
          style={{
            marginTop: 18,
            padding: "9px 16px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-card-2)",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "var(--font-display)",
            cursor: busy === statement.id ? "default" : "pointer",
          }}
          title="Re-runs the match against current transactions. No model call, no cost."
        >
          {busy === statement.id ? "Reconciling…" : "Reconcile again"}
        </button>
      </div>
    </section>
  );
}

function Figure({ label, value }) {
  return (
    <div>
      <div style={mutedStyle}>{label}</div>
      <div style={{ ...numStyle, fontSize: 16, fontWeight: 700 }}>
        {value == null ? "—" : fmtINR(value)}
      </div>
    </div>
  );
}

// ── What still needs a bill ──
function OutstandingCard({ rows, minAmount }) {
  return (
    <section>
      <h2 style={sectionLabelStyle}>Needs a receipt</h2>
      <div style={cardStyle}>
        {!rows?.length ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Nothing outstanding above {fmtINR(minAmount ?? 500)}.
          </div>
        ) : (
          <>
            <div style={{ ...mutedStyle, marginBottom: 6 }}>
              {plural(rows.length, "charge")}, largest first. Anything under{" "}
              {fmtINR(minAmount ?? 500)} is waived automatically.
            </div>
            {rows.map((t) => (
              <div key={t.id} style={rowStyle}>
                <span style={{ ...numStyle, ...mutedStyle, width: 58 }}>{fmtDay(t.date)}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{t.merchant}</span>
                <span style={{ ...numStyle, fontWeight: 700 }}>{fmtINR(t.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

// ── Bills that have come in ──
const RECEIPT_TONE = {
  matched: "var(--success)",
  pending: "var(--text-muted)",
  unmatched: "var(--danger)",
  duplicate: "var(--text-muted)",
  rejected: "var(--danger)",
};

function ReceiptListCard({ receipts }) {
  const [openId, setOpenId] = useState(null);
  const [preview, setPreview] = useState(null);

  const open = async (id) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setPreview(null);
    try {
      const r = await fetch(`/api/receipts?id=${id}`);
      setPreview(await r.json());
    } catch {
      setPreview({ url: null });
    }
  };

  return (
    <section>
      <h2 style={sectionLabelStyle}>Receipts</h2>
      <div style={cardStyle}>
        {!receipts?.length ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            No receipts yet. Send a photo of a bill to the Telegram bot and it will appear here.
          </div>
        ) : (
          receipts.map((r) => (
            <div key={r.id}>
              <div
                style={{ ...rowStyle, cursor: "pointer" }}
                onClick={() => open(r.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && open(r.id)}
              >
                <span style={{ ...numStyle, ...mutedStyle, width: 58 }}>
                  {fmtDay(r.receipt_date || r.created_at)}
                </span>
                <span style={{ flex: 1, fontWeight: 500 }}>
                  {r.merchant || "Unread"}
                  {r.country && r.country !== "IN" ? (
                    <span style={mutedStyle}> · {r.country}</span>
                  ) : null}
                </span>
                <span style={{ ...numStyle, fontWeight: 700 }}>
                  {r.currency && r.currency !== "INR"
                    ? `${r.currency} ${Number(r.amount || 0).toFixed(2)}`
                    : fmtINR(r.amount)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: RECEIPT_TONE[r.status] || "var(--text-muted)",
                    width: 76,
                    textAlign: "right",
                  }}
                >
                  {r.status}
                </span>
              </div>

              {openId === r.id && (
                <div style={{ padding: "12px 0 18px", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  <div>
                    Read by <strong>{r.consensus || "—"}</strong>
                    {r.confidence != null ? ` · confidence ${Number(r.confidence).toFixed(2)}` : ""}
                    {r.doc_type ? ` · ${r.doc_type}` : ""}
                  </div>
                  <div>
                    {r.match?.transaction
                      ? `Matched to ${r.match.transaction.merchant} · ${fmtINR(
                          r.match.transaction.amount
                        )} on ${fmtDay(r.match.transaction.date)}${
                          r.match.match_score != null ? ` (score ${r.match.match_score})` : ""
                        }`
                      : "Not yet bound to a charge."}
                  </div>
                  {preview === null ? (
                    <div style={mutedStyle}>Loading preview…</div>
                  ) : preview.url ? (
                    <a
                      href={preview.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--brand)", fontWeight: 600 }}
                    >
                      Open the receipt ↗
                    </a>
                  ) : (
                    <div style={mutedStyle}>The stored file could not be read.</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ── What has gone to accounts ──
function SubmissionsCard({ submissions }) {
  return (
    <section>
      <h2 style={sectionLabelStyle}>Submissions</h2>
      <div style={cardStyle}>
        {!submissions?.length ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Nothing sent yet. The package is built on the submit day and waits for your approval —
            no automated job can mail it on its own.
          </div>
        ) : (
          submissions.map((s) => (
            <div key={s.id} style={rowStyle}>
              <span style={{ ...numStyle, ...mutedStyle, width: 58 }}>{fmtDay(s.created_at)}</span>
              <span style={{ flex: 1 }}>
                {plural(s.line_count ?? 0, "line")} · {plural(s.receipt_count ?? 0, "receipt")} ·{" "}
                {s.coverage_pct ?? 0}%
              </span>
              <span style={{ ...numStyle, fontWeight: 700 }}>{fmtINR(s.total_amount)}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  width: 76,
                  textAlign: "right",
                  color: s.status === "sent" ? "var(--success)" : s.status === "failed" ? "var(--danger)" : "var(--text-muted)",
                }}
              >
                {s.status}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
