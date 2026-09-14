"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { fmtINR } from "../overview/aggregations";
import Icon from "../ui/Icon";
import { Banner, Button, Card, Chip, Empty, Field, Notice, Segmented } from "../ui/kit";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "card", label: "Corporate card", icon: "card" },
  { id: "gmail", label: "Gmail sync", icon: "mail" },
  { id: "mailboxes", label: "Invoice mailboxes", icon: "mail" },
  { id: "bot", label: "Receipt bot", icon: "bot" },
  { id: "password", label: "Password", icon: "lock" },
  { id: "activity", label: "Activity log", icon: "activity" },
];

export default function SettingsTab({ session, isMobile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "190px minmax(0, 760px)", gap: 24, alignItems: "start" }}>
      {!isMobile && (
        <nav aria-label="Settings sections" style={{ position: "sticky", top: 24, display: "flex", flexDirection: "column", gap: 2 }}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#settings-${s.id}`} className="nav-item" style={{ fontSize: 13 }}>
              <Icon name={s.icon} size={16} />
              {s.label}
            </a>
          ))}
        </nav>
      )}
      <div className="stack">
        <ProfileCard session={session} />
        <CorporateCardCard />
        <ConnectionCard />
        <MailboxesCard />
        <ReceiptBotCard />
        <PasswordCard />
        <ActivityCard />
      </div>
    </div>
  );
}

function Section({ id, title, hint, action, children, flush }) {
  return (
    <div id={`settings-${id}`} style={{ scrollMarginTop: 80 }}>
      <Card title={title} hint={hint} action={action} flush={flush} padLg={!flush}>
        {children}
      </Card>
    </div>
  );
}

const Lead = ({ children }) => <p className="small muted" style={{ lineHeight: 1.55, marginBottom: 16, maxWidth: "64ch" }}>{children}</p>;

function ProfileCard({ session }) {
  const [avatarUrl, setAvatarUrl] = useState(session?.user?.image || null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const fileInputRef = useRef(null);

  const upload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMsg({ text: "", type: "" });
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      const res = await fetch("/api/avatar", { method: "POST", body: fd });
      const data = await res.json();
      if (data.avatar_url) {
        setAvatarUrl(data.avatar_url);
        setMsg({ text: "Photo updated", type: "success" });
      } else {
        setMsg({ text: data.error || "Upload failed — use a JPG, PNG or WebP image", type: "error" });
      }
    } catch {
      setMsg({ text: "Upload failed — check your connection", type: "error" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const user = session?.user;

  return (
    <Section id="profile" title="Profile">
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>
          {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : user?.name?.[0]?.toUpperCase() || "?"}
        </span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{user?.name || "You"}</div>
          <div className="small muted">{user?.email}</div>
        </div>
        <input ref={fileInputRef} id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} />
        <div style={{ display: "flex", gap: 8 }}>
          <Button icon="upload" onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "Change photo"}</Button>
          <Button variant="danger" icon="logout" onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</Button>
        </div>
      </div>
      <div style={{ marginTop: 10 }}><Notice msg={msg} /></div>
    </Section>
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
    if (pw.length < 8) return setMsg({ text: "New password must be at least 8 characters", type: "error" });
    if (pw !== confirm) return setMsg({ text: "The two new passwords don't match", type: "error" });
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: pw }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: "Password changed", type: "success" });
        setCurrent("");
        setPw("");
        setConfirm("");
      } else {
        setMsg({ text: data.error || "Could not change the password", type: "error" });
      }
    } catch {
      setMsg({ text: "Could not change the password — check your connection", type: "error" });
    }
    setSaving(false);
  };

  return (
    <Section id="password" title="Password" hint="for email sign-in">
      <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
        <Field label="Current password" htmlFor="pw-current">
          <input id="pw-current" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </Field>
        <div className="form-grid">
          <Field label="New password" htmlFor="pw-new">
            <input id="pw-new" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} placeholder="At least 8 characters" autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm">
            <input id="pw-confirm" className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        <Notice msg={msg} />
        <div><button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : "Update password"}</button></div>
      </form>
    </Section>
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
      setMsg("Diagnostics failed: " + e.message);
    }
    setLoading(false);
  };

  const forceResync = async () => {
    if (!confirm("Re-scan every email from scratch on the next sync? This can take several minutes.")) return;
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
    <Section id="gmail" title="Gmail sync" action={
      <span style={{ display: "flex", gap: 8 }}>
        <Button size="sm" icon="activity" onClick={runDiag} disabled={loading}>{loading ? "Checking…" : "Run diagnostics"}</Button>
        <Button size="sm" variant="danger" icon="sync" onClick={forceResync} disabled={resetting}>{resetting ? "Resetting…" : "Full resync"}</Button>
      </span>
    }>
      <Lead>Charges come from HDFC alert emails in your Gmail. Diagnostics show when it last synced, what each search found, and the newest charges saved.</Lead>

      {msg && <div className="small" style={{ padding: 10, background: "var(--bg-card-2)", borderRadius: 8, marginBottom: 12 }}>{msg}</div>}

      {diag && (
        <div className="stack" style={{ gap: 14 }}>
          {diag.error && <Banner tone="bad" title={diag.error} />}
          <dl className="kv-list">
            <div><dt>Account</dt><dd>{diag.userEmail || "—"}</dd></div>
            <div><dt>Last synced</dt><dd className="num">{diag.lastSyncedAt ? new Date(diag.lastSyncedAt).toLocaleString("en-IN") : "never"}</dd></div>
            <div><dt>Date filter</dt><dd className="num small">{diag.dateFilter}</dd></div>
          </dl>

          {diag.gmailQueries && (
            <div className="card flush">
              {diag.gmailQueries.map((q) => (
                <div key={q.name} className="list-row" style={{ alignItems: "flex-start" }}>
                  <span className="grow">
                    <div className="title">{q.name}</div>
                    <div className="meta num" style={{ whiteSpace: "normal", wordBreak: "break-all" }}>{q.query || q.error}</div>
                  </span>
                  <Chip tone={q.error ? "bad" : q.count > 0 ? "ok" : null}>{q.error ? "Error" : `${q.count} emails`}</Chip>
                </div>
              ))}
            </div>
          )}

          {diag.recentTxns?.length > 0 && (
            <div className="card flush">
              {diag.recentTxns.map((t) => (
                <div key={t.email_id} className="list-row">
                  <span className="num small muted" style={{ width: 84 }}>{t.date}</span>
                  <span className="grow title">{t.merchant}</span>
                  <span className="amt">{fmtINR(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Corporate Card ──
// Nothing in Receipt Rail runs without this row: cycles, nudges, statement
// ingest and the submission package all read their dates and recipients here.
function CorporateCardCard() {
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ loading: true, saving: false, encryptionReady: true, error: "" });
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "" });

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/card-account");
      if (!r.ok) throw new Error(`The card endpoint answered ${r.status}`);
      const data = await r.json();
      setForm({
        entity_name: data.card?.entity_name ?? "VIP Industries Limited",
        label: data.card?.label ?? "HDFC Corporate",
        last4: data.card?.last4 ?? "",
        statement_day: data.card?.statement_day ?? 18,
        submit_day: data.card?.submit_day ?? 23,
        min_receipt_amount: data.card?.min_receipt_amount ?? 500,
        accounts_email: (data.card?.accounts_email ?? []).join(", "),
        cc_email: (data.card?.cc_email ?? []).join(", "),
        forex_markup_pct: data.card?.forex_markup_pct ?? 3.5,
        forex_gst_pct: data.card?.forex_gst_pct ?? 18,
      });
      setHasPassword(Boolean(data.card?.hasStatementPassword));
      setState((s) => ({ ...s, loading: false, error: "", encryptionReady: data.encryptionReady !== false }));
      if (data.card && data.card.hasStatementPassword && data.card.statementPasswordEncrypted === false) {
        setMsg({ text: "The stored statement password predates encryption. Re-enter it to encrypt it at rest.", type: "error" });
      }
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setState((s) => ({ ...s, saving: true }));
    setMsg({ text: "", type: "" });
    try {
      // Absent means "leave it alone" — the password is only sent when typed.
      const body = { ...form };
      if (password) body.statement_password = password;

      const r = await fetch("/api/card-account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();

      if (r.ok) {
        setMsg({ text: "Card saved", type: "success" });
        setPassword("");
        setHasPassword(Boolean(data.card?.hasStatementPassword));
      } else {
        setMsg({ text: data.error || "Could not save the card", type: "error" });
      }
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
    setState((s) => ({ ...s, saving: false }));
  };

  return (
    <Section id="card" title="Corporate card" hint="drives the receipt cycle">
      {state.error ? (
        <Empty icon="alert" title="Could not load the card" action={<Button icon="sync" onClick={load}>Try again</Button>}>{state.error}</Empty>
      ) : state.loading || !form ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <CardPreview form={form} />

          <div className="form-grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
            <Field label="Company" htmlFor="card-entity">
              <input id="card-entity" className="input" value={form.entity_name} onChange={set("entity_name")} />
            </Field>
            <Field label="Last 4 digits" htmlFor="card-last4">
              <input id="card-last4" className="input num" inputMode="numeric" maxLength={4} value={form.last4} onChange={set("last4")} placeholder="7634" />
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Statement day" htmlFor="card-stmt" help="Day of month HDFC issues it">
              <input id="card-stmt" className="input num" type="number" min={1} max={31} value={form.statement_day} onChange={set("statement_day")} />
            </Field>
            <Field label="Submit day" htmlFor="card-submit" help="Day the package goes to accounts">
              <input id="card-submit" className="input num" type="number" min={1} max={31} value={form.submit_day} onChange={set("submit_day")} />
            </Field>
            <Field label="Receipt needed above" htmlFor="card-min" help={`Charges under ${fmtINR(Number(form.min_receipt_amount) || 0)} are never chased`}>
              <input id="card-min" className="input num" type="number" min={0} step="50" value={form.min_receipt_amount} onChange={set("min_receipt_amount")} />
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Accounts email" htmlFor="card-accounts" help="Comma separated">
              <input id="card-accounts" className="input" type="text" value={form.accounts_email} onChange={set("accounts_email")} placeholder="accounts@vipindustries.com" />
            </Field>
            <Field label="CC (optional)" htmlFor="card-cc">
              <input id="card-cc" className="input" type="text" value={form.cc_email} onChange={set("cc_email")} placeholder="finance@vipindustries.com" />
            </Field>
          </div>

          <Field
            label="Statement PDF password"
            htmlFor="card-pdfpw"
            help={state.encryptionReady ? "Encrypted at rest and only used to open the statement. Never logged or shown again." : "STATEMENT_PW_KEY isn't set on the server, so the password can't be stored yet."}
          >
            <input id="card-pdfpw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={hasPassword ? "Saved — type to replace" : "HDFC e-statement password"} autoComplete="off" />
          </Field>

          <details>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-secondary)" }}>Foreign charges</summary>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Forex markup %" htmlFor="card-fx">
                <input id="card-fx" className="input num" type="number" step="0.1" value={form.forex_markup_pct} onChange={set("forex_markup_pct")} />
              </Field>
              <Field label="GST on markup %" htmlFor="card-fxgst">
                <input id="card-fxgst" className="input num" type="number" step="0.1" value={form.forex_gst_pct} onChange={set("forex_gst_pct")} />
              </Field>
            </div>
            <p className="small muted" style={{ marginTop: 8, lineHeight: 1.5 }}>A foreign bill never equals its rupee charge, so it's matched within the band these two numbers predict.</p>
          </details>

          <Notice msg={msg} />
          <div><button type="submit" className="btn primary" disabled={state.saving}>{state.saving ? "Saving…" : "Save card"}</button></div>
        </form>
      )}
    </Section>
  );
}

/** A small rendering of the physical card so the cycle settings read as belonging to it. */
function CardPreview({ form }) {
  return (
    <div
      aria-hidden="true"
      style={{
        maxWidth: 320,
        aspectRatio: "1.586 / 1",
        borderRadius: 14,
        padding: 16,
        color: "#EAF4F2",
        background: "linear-gradient(135deg, #0E3B35 0%, #0E6B5E 60%, #1F9AA8 100%)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "var(--shadow-hover)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>
        <span>{form.label || "HDFC Corporate"}</span>
        <span style={{ width: 30, height: 22, borderRadius: 4, background: "linear-gradient(135deg,#E9D8A6,#C9A94F)" }} />
      </div>
      <div className="num" style={{ fontSize: 17, letterSpacing: "0.12em" }}>•••• •••• •••• {form.last4 || "····"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, opacity: 0.9 }}>
        <span style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{form.entity_name}</span>
        <span className="num">Stmt {form.statement_day} · Submit {form.submit_day}</span>
      </div>
    </div>
  );
}

// ── Mailboxes ──
// Connected email accounts from which the harvester reads invoices. Credentials
// are write-only and encrypted; they are proved by connecting and never returned.
function MailboxesCard() {
  const [data, setData] = useState({ accounts: [], encryptionReady: true, connectUrl: "" });
  const [form, setForm] = useState({ email: "", app_password: "" });
  const [busy, setBusy] = useState(false);
  const [showAppPw, setShowAppPw] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/mail-accounts");
      if (r.ok) setData(await r.json());
    } catch {
      setMsg({ text: "Could not load mailboxes", type: "error" });
    }
  }, []);

  useEffect(() => {
    load();
    // Surface ?mailbox= from the OAuth redirect, then clear it.
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("mailbox");
    if (outcome) {
      const reason = params.get("reason");
      setMsg(
        outcome === "connected" ? { text: "Mailbox connected.", type: "success" }
        : outcome === "denied" ? { text: "Google access was declined.", type: "error" }
        : { text: `Could not connect: ${reason || "unknown error"}`, type: "error" }
      );
      params.delete("mailbox");
      params.delete("reason");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }
  }, [load]);

  const addAppPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: "", type: "" });
    try {
      const r = await fetch("/api/mail-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, app_password: form.app_password }),
      });
      const result = await r.json();
      if (r.ok) {
        setForm({ email: "", app_password: "" });
        setShowAppPw(false);
        await load();
        setMsg({ text: "Mailbox added.", type: "success" });
      } else {
        setMsg({ text: result.error || "Could not add the mailbox", type: "error" });
      }
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
    setBusy(false);
  };

  const remove = async (id) => {
    if (!confirm("Remove this mailbox? Invoices will no longer be read from it.")) return;
    setBusy(true);
    setMsg({ text: "", type: "" });
    try {
      const r = await fetch(`/api/mail-accounts?id=${id}`, { method: "DELETE" });
      if (r.ok) await load();
      else {
        const result = await r.json();
        setMsg({ text: result.error || "Could not remove the mailbox", type: "error" });
      }
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
    setBusy(false);
  };

  return (
    <Section id="mailboxes" title="Invoice mailboxes">
      <Lead>Inboxes where vendors send invoices. Vippy reads them and files each bill against its charge.</Lead>

      {!data.encryptionReady ? (
        <Banner title="Mailboxes can't be connected yet">Set STATEMENT_PW_KEY on the server first.</Banner>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {data.accounts?.length > 0 && (
            <div className="card flush">
              {data.accounts.map((account) => (
                <div key={account.id} className="list-row" style={{ flexWrap: "wrap" }}>
                  <span className="merchant-avatar" style={{ background: account.status === "revoked" ? "var(--danger-bg)" : "var(--brand-subtle)", color: account.status === "revoked" ? "var(--danger)" : "var(--brand-strong-text)" }}>
                    <Icon name="mail" size={15} />
                  </span>
                  <span className="grow">
                    <div className="title">{account.email}</div>
                    <div className="meta" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                      <Chip tone={account.role === "primary" ? "ok" : null}>{account.role === "primary" ? "Primary" : "Invoices"}</Chip>
                      {account.auth_kind === "oauth" ? "Google" : "App password"}
                    </div>
                    {account.status === "revoked" && <div className="small" style={{ color: "var(--danger)", fontWeight: 600, marginTop: 4 }}>Access lost — reconnect this mailbox.</div>}
                  </span>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(account.id)} disabled={busy}>Remove</Button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn primary" href={data.connectUrl}><Icon name="link" size={16} /> Connect Google account</a>
            <Button onClick={() => setShowAppPw((v) => !v)} iconRight={showAppPw ? "chevronDown" : undefined}>Use an app password</Button>
          </div>

          {showAppPw && (
            <form onSubmit={addAppPassword} className="form-grid" style={{ alignItems: "end" }}>
              <Field label="Email address" htmlFor="mb-email">
                <input id="mb-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={busy} />
              </Field>
              <Field label="App password" htmlFor="mb-pw">
                <input id="mb-pw" className="input" type="password" value={form.app_password} onChange={(e) => setForm({ ...form, app_password: e.target.value })} disabled={busy} />
              </Field>
              <div><button type="submit" className="btn" disabled={busy || !form.email || !form.app_password}>{busy ? "Adding…" : "Add mailbox"}</button></div>
            </form>
          )}
        </div>
      )}
      <div style={{ marginTop: 10 }}><Notice msg={msg} /></div>
    </Section>
  );
}

// ── Receipt Bot ──
// Binds one Telegram chat to this account. The code is single-use and short
// lived, so a screenshot of it in a group chat is worth nothing an hour later.
function ReceiptBotCard() {
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/telegram/link");
      setLink(await r.json());
    } catch {
      setMsg("Could not read the link state");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const issue = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/telegram/link", { method: "POST" });
      const data = await r.json();
      if (r.ok) await load();
      else setMsg(data.error || "Could not issue a code");
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };

  const unlink = async () => {
    if (!confirm("Unlink the chat? The bot stops accepting receipts until you link again.")) return;
    setBusy(true);
    setMsg("");
    try {
      await fetch("/api/telegram/link", { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };

  return (
    <Section id="bot" title="Receipt bot" action={link?.linked ? <Chip tone="ok">Linked</Chip> : link ? <Chip>Not linked</Chip> : null}>
      <Lead>Photograph a bill, send it to the Telegram bot, and it files itself against the right charge.</Lead>

      {link?.linked ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="merchant-avatar" style={{ background: "var(--success-bg)", color: "var(--success)" }}><Icon name="bot" size={16} /></span>
            <span><b>Chat linked</b>{link.username && <span className="muted"> · @{link.username}</span>}</span>
          </span>
          <Button variant="danger" onClick={unlink} disabled={busy}>Unlink</Button>
        </div>
      ) : link?.pendingCode ? (
        <div className="stack" style={{ gap: 10 }}>
          <span className="small muted">Open the bot in Telegram and send this message:</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "0.04em", padding: "8px 14px", background: "var(--bg-card-2)", borderRadius: 8, border: "1px dashed var(--border-strong)" }}>
              /start {link.pendingCode}
            </code>
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(`/start ${link.pendingCode}`)}>Copy</Button>
          </div>
          <span className="small muted">Single use · expires {link.codeExpiresAt ? new Date(link.codeExpiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "shortly"}</span>
          <div><Button icon="sync" onClick={issue} disabled={busy}>{busy ? "Working…" : "New code"}</Button></div>
        </div>
      ) : (
        <Button variant="primary" icon="bot" onClick={issue} disabled={busy}>{busy ? "Working…" : "Link a Telegram chat"}</Button>
      )}

      {msg && <div className="small" style={{ color: "var(--danger)", marginTop: 12 }}>{msg}</div>}
    </Section>
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
      setHint("Could not load the activity log");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const tone = (l) => (l === "error" ? "bad" : l === "warn" ? "warn" : "info");
  const fmtDt = (s) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Section id="activity" title="Activity log" flush action={
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Segmented label="Level" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "error", label: "Errors" }, { value: "warn", label: "Warnings" }, { value: "info", label: "Info" }]} />
        <Button size="sm" variant="ghost" icon="sync" onClick={load} aria-label="Refresh" />
      </span>
    }>
      {hint && <div style={{ padding: "0 16px 12px" }}><Banner title={hint} /></div>}
      {loading ? (
        <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 160 }} /></div>
      ) : logs.length === 0 ? (
        <Empty icon="activity" title="Nothing logged">Sync runs, receipts and statements leave a trail here.</Empty>
      ) : (
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {logs.map((log) => (
            <div key={log.id} className="list-row" style={{ alignItems: "flex-start" }}>
              <Chip tone={tone(log.level)}>{log.level}</Chip>
              <span className="grow">
                <div style={{ fontSize: 13 }}>
                  <b>{log.source}</b> <span className="muted">{log.event}</span>
                </div>
                {log.message && <div className="small" style={{ color: "var(--text-secondary)", marginTop: 2, whiteSpace: "normal" }}>{log.message}</div>}
                {log.details && (
                  <details style={{ marginTop: 4 }}>
                    <summary className="small muted" style={{ cursor: "pointer" }}>Details</summary>
                    <pre className="num" style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "auto", marginTop: 6, padding: 10, background: "var(--bg-card-2)", borderRadius: 6 }}>
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </details>
                )}
              </span>
              <span className="num small muted" style={{ whiteSpace: "nowrap" }}>{fmtDt(log.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
