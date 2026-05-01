"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { fmtINR } from "../overview/aggregations";

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
  padding: 26,
};

const fieldLabel = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 6,
  fontFamily: "var(--font-display)",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-card-2)",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "var(--font-body)",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const onFocus = (e) => {
  e.target.style.borderColor = "var(--brand)";
  e.target.style.boxShadow = "0 0 0 3px var(--brand-subtle)";
};
const onBlur = (e) => {
  e.target.style.borderColor = "var(--border)";
  e.target.style.boxShadow = "none";
};

export default function SettingsTab({ session }) {
  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 36 }}>
      <ProfileCard session={session} />
      <PasswordCard />
      <ConnectionCard />
      <ActivityCard />
      <AccountCard />
    </div>
  );
}

function ProfileCard({ session }) {
  const [avatarUrl, setAvatarUrl] = useState(session?.user?.image || null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useRef(null);

  const upload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      const res = await fetch("/api/avatar", { method: "POST", body: fd });
      const data = await res.json();
      if (data.avatar_url) {
        setAvatarUrl(data.avatar_url);
        setUploadMsg("Avatar updated");
      } else {
        setUploadMsg(data.error || "Upload failed");
      }
    } catch {
      setUploadMsg("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setUploadMsg(""), 3000);
    }
  }, []);

  const user = session?.user;

  return (
    <section>
      <h2 style={sectionLabelStyle}>Profile</h2>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border)" }}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: "var(--brand)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 32,
                  fontWeight: 700,
                  fontFamily: "var(--font-display)",
                }}
              >
                {user?.name?.[0]?.toUpperCase() || "?"}
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {user?.name || "User"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{user?.email}</div>
            {uploadMsg && (
              <div style={{ fontSize: 12, marginTop: 8, color: uploadMsg.includes("fail") ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>
                {uploadMsg}
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={upload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg-card-2)",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-display)",
              opacity: uploading ? 0.6 : 1,
              cursor: uploading ? "default" : "pointer",
            }}
          >
            {uploading ? "Uploading…" : "Change avatar"}
          </button>
        </div>
      </div>
    </section>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });

  const submit = async (e) => {
    e.preventDefault();
    setMsg({ text: "", type: "" });
    if (pw.length < 8) return setMsg({ text: "Password must be at least 8 characters", type: "error" });
    if (pw !== confirm) return setMsg({ text: "Passwords do not match", type: "error" });
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: pw }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: "Password changed successfully", type: "success" });
        setCurrent("");
        setPw("");
        setConfirm("");
      } else {
        setMsg({ text: data.error || "Failed to change password", type: "error" });
      }
    } catch {
      setMsg({ text: "Failed to change password", type: "error" });
    }
    setSaving(false);
  };

  return (
    <section>
      <h2 style={sectionLabelStyle}>Password</h2>
      <div style={cardStyle}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={fieldLabel}>Current password</div>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required style={inputStyle} autoComplete="current-password" onFocus={onFocus} onBlur={onBlur} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={fieldLabel}>New password</div>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} placeholder="Min 8 characters" style={inputStyle} autoComplete="new-password" onFocus={onFocus} onBlur={onBlur} />
            </div>
            <div>
              <div style={fieldLabel}>Confirm new</div>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} style={inputStyle} autoComplete="new-password" onFocus={onFocus} onBlur={onBlur} />
            </div>
          </div>
          {msg.text && (
            <div style={{ fontSize: 12, fontWeight: 600, color: msg.type === "error" ? "var(--danger)" : "var(--success)" }}>
              {msg.text}
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "12px 22px",
              borderRadius: 10,
              border: "none",
              background: saving ? "var(--bg-card-2)" : "var(--brand)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              alignSelf: "flex-start",
              fontFamily: "var(--font-display)",
              letterSpacing: "0.02em",
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </section>
  );
}

function ConnectionCard() {
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState("");

  const runDiag = async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/sync/debug");
      setDiag(await r.json());
    } catch (e) {
      setMsg("Diagnostic failed: " + e.message);
    }
    setLoading(false);
  };

  const forceResync = async () => {
    if (!confirm("Clear last_synced_at? Next sync will re-scan every email from scratch.")) return;
    setResetting(true);
    setMsg("");
    try {
      const r = await fetch("/api/sync/debug", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) });
      const data = await r.json();
      setMsg(data.message || data.error);
      if (data.ok) await runDiag();
    } catch (e) {
      setMsg("Reset failed: " + e.message);
    }
    setResetting(false);
  };

  return (
    <section>
      <h2 style={sectionLabelStyle}>Gmail Connection</h2>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Diagnose sync state — last sync time, Gmail query results, and latest transactions in the database.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={runDiag}
              disabled={loading}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-card-2)",
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-display)",
                letterSpacing: "0.02em",
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? "Checking…" : "Run diagnostics"}
            </button>
            <button
              onClick={forceResync}
              disabled={resetting}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid var(--warning)",
                background: "transparent",
                color: "var(--warning)",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-display)",
                letterSpacing: "0.02em",
                cursor: resetting ? "default" : "pointer",
              }}
            >
              {resetting ? "Resetting…" : "Force full resync"}
            </button>
          </div>
        </div>

        {msg && (
          <div style={{ padding: 12, background: "var(--bg-card-2)", borderRadius: 10, fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
            {msg}
          </div>
        )}

        {diag && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {diag.error && (
              <div style={{ padding: 12, background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 10, fontSize: 12 }}>
                {diag.error}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 18px", fontSize: 13 }}>
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Email</span>
              <span style={{ color: "var(--text)" }}>{diag.userEmail || "—"}</span>
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Last synced</span>
              <span style={{ ...numStyle, color: "var(--text)" }}>{diag.lastSyncedAt || "never"}</span>
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Date filter</span>
              <span style={{ color: "var(--text)", fontFamily: "monospace", fontSize: 12 }}>{diag.dateFilter}</span>
            </div>

            {diag.gmailQueries && (
              <div>
                <div style={{ ...sectionLabelStyle, marginBottom: 10, fontSize: 10 }}>Gmail Queries</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {diag.gmailQueries.map((q) => (
                    <div key={q.name} style={{ padding: "10px 14px", background: "var(--bg-card-2)", borderRadius: 8, fontSize: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: "var(--text)" }}>{q.name}</span>
                        <span style={{ color: q.error ? "var(--danger)" : q.count > 0 ? "var(--success)" : "var(--text-muted)", fontWeight: 700, ...numStyle }}>
                          {q.error ? "ERROR" : `${q.count} emails`}
                        </span>
                      </div>
                      <div style={{ color: "var(--text-muted)", fontFamily: "monospace", marginTop: 4, fontSize: 11, wordBreak: "break-all" }}>{q.query || q.error}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {diag.recentTxns && diag.recentTxns.length > 0 && (
              <div>
                <div style={{ ...sectionLabelStyle, marginBottom: 10, fontSize: 10 }}>Latest 5 transactions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {diag.recentTxns.map((t) => (
                    <div key={t.email_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 12px", background: "var(--bg-card-2)", borderRadius: 6 }}>
                      <span style={{ color: "var(--text)" }}>
                        {t.date} · {t.merchant}
                      </span>
                      <span style={{ ...numStyle, fontWeight: 700, color: "var(--text)" }}>{fmtINR(t.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityCard() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [hint, setHint] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter === "all" ? "" : `?level=${filter}`;
      const r = await fetch(`/api/logs${q}`);
      const data = await r.json();
      setLogs(data.logs || []);
      setHint(data.error || null);
    } catch {
      setHint("Failed to load logs");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const levelColor = (l) => (l === "error" ? "var(--danger)" : l === "warn" ? "var(--warning)" : "var(--info)");
  const levelBg = (l) => (l === "error" ? "var(--danger-bg)" : l === "warn" ? "var(--warning-bg)" : "var(--bg-card-2)");

  const fmtDt = (s) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section>
      <h2 style={sectionLabelStyle}>Activity Log</h2>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["all", "error", "warn", "info"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: "1px solid",
                  borderColor: filter === f ? "var(--brand)" : "var(--border)",
                  background: filter === f ? "var(--brand-subtle)" : "transparent",
                  color: filter === f ? "var(--brand)" : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "capitalize",
                  letterSpacing: "0.04em",
                  fontFamily: "var(--font-display)",
                  cursor: "pointer",
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "var(--bg-card-2)",
              color: "var(--text)",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "var(--font-display)",
              letterSpacing: "0.04em",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>

        {hint && (
          <div style={{ padding: 12, background: "var(--warning-bg)", borderRadius: 10, fontSize: 12, color: "var(--warning)", marginBottom: 14 }}>
            {hint}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No logs yet.</div>
        ) : (
          <div style={{ maxHeight: 480, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: levelBg(log.level),
                  borderLeft: `3px solid ${levelColor(log.level)}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: levelColor(log.level),
                        color: "#fff",
                        fontFamily: "var(--font-display)",
                      }}
                    >
                      {log.level}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, fontFamily: "var(--font-display)" }}>{log.source}</span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{log.event}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", ...numStyle }}>{fmtDt(log.created_at)}</span>
                </div>
                {log.message && <div style={{ fontSize: 12, color: "var(--text)" }}>{log.message}</div>}
                {log.details && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 10, color: "var(--text-muted)", cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>Details</summary>
                    <pre style={{ fontSize: 10, color: "var(--text-secondary)", overflow: "auto", marginTop: 6, padding: 10, background: "var(--bg-card)", borderRadius: 6 }}>
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AccountCard() {
  return (
    <section>
      <h2 style={sectionLabelStyle}>Account</h2>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4, fontFamily: "var(--font-display)" }}>Sign out</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>End your session on this device.</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "1px solid var(--danger)",
              background: "transparent",
              color: "var(--danger)",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "var(--font-display)",
              letterSpacing: "0.02em",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--danger)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--danger)";
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
