"use client";

import { useState, useEffect, useRef } from "react";
import { X, Sparkles } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { fmt, fmtDate, fmtTime } from "@/lib/formatters";

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-[var(--border)]">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="text-sm font-medium text-[var(--text)] text-right max-w-[60%]">{value}</span>
    </div>
  );
}

export function TransactionModal({ transaction: t, onClose, onUpdateNotes }) {
  const [userNotes, setUserNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const modalRef = useRef(null);

  useEffect(() => { if (t) setUserNotes(t.userNotes || ""); }, [t]);
  useEffect(() => { if (t) modalRef.current?.focus(); }, [t]);

  if (!t) return null;
  const cat = CATEGORIES[t.category] || CATEGORIES.other;
  const CatIcon = cat.icon;

  const handleSaveNotes = async () => {
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await fetch("/api/transactions", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, userNotes }),
      });
      if (!res.ok) throw new Error("Save failed");
      onUpdateNotes(t.id, userNotes);
      setSaveStatus("Saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch {
      setSaveStatus("Error saving");
    }
    setSaving(false);
  };

  return (
    <div
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[1000] p-4 animate-[fadeIn_0.15s_ease]"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-card)] rounded-xl p-7 max-md:p-5 max-w-[460px] w-full relative shadow-xl max-h-[90vh] overflow-y-auto border border-[var(--border)] outline-none animate-[scaleIn_0.2s_ease]"
      >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 w-7 h-7 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
          >
            <X size={16} />
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center"
              style={{ background: cat.color + "18" }}
            >
              <CatIcon size={22} style={{ color: cat.color }} />
            </div>
            <div>
              <div id="modal-title" className="font-semibold text-[17px] text-[var(--text)]">{t.merchant}</div>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: cat.color + "18", color: cat.color }}
              >
                {cat.label}
              </span>
            </div>
          </div>

          <div className="text-3xl font-bold mb-5 tabular-nums tracking-tight" style={{ color: t.isRefund ? "var(--success)" : "var(--text)" }}>
            {t.isRefund ? "+" : ""}{fmt(t.amount)}
            {t.isRefund && (
              <span className="text-[11px] font-semibold text-[var(--success)] bg-[var(--success-bg)] px-2 py-0.5 rounded ml-2 align-middle">
                REFUND
              </span>
            )}
          </div>

          <div className="flex flex-col">
            <Row label="Date" value={fmtDate(t.date)} />
            <Row label="Time" value={t.txnTime ? fmtTime(t.txnTime) : "Not available"} />
            {t.itemDescription && <Row label="Item" value={t.itemDescription} />}
            <Row label="Receipt" value={t.hasReceipt ? "\u2713 Attached" : "\u25CB Missing"} />
            {t.rawEmail && <Row label="Source" value={t.rawEmail} />}
          </div>

          {t.notes && (
            <div className="p-3.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] mt-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={12} className="text-[var(--accent)]" />
                <span className="text-[11px] text-[var(--text-tertiary)] font-semibold uppercase tracking-wider">AI Insight</span>
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed">{t.notes}</div>
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="user-notes" className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">Your Notes</label>
            <textarea
              id="user-notes"
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Add a note..."
              className="w-full px-3 py-2.5 border border-[var(--border)] rounded-lg text-sm resize-y min-h-[60px] leading-relaxed bg-[var(--bg-card)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none transition-colors"
            />
            <div className="flex items-center gap-2.5 mt-1.5">
              <button
                onClick={handleSaveNotes}
                disabled={saving}
                className="px-4 py-1.5 rounded-md border-none text-white text-xs font-semibold transition-opacity disabled:opacity-50"
                style={{ background: saving ? "var(--bg-tertiary)" : "var(--accent)" }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {saveStatus && (
                <span className="text-[11px] font-medium" style={{ color: saveStatus === "Saved" ? "var(--success)" : "var(--danger)" }}>
                  {saveStatus}
                </span>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}
