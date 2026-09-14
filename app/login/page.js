"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg-page)" }} />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const urlError = searchParams.get("error");

  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    urlError === "OAuthCallback"
      ? "Google sign-in failed. Check that the redirect URI is registered in Google Cloud Console."
      : urlError
      ? "Sign-in failed. Please try again."
      : ""
  );

  const handleCredentials = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Sign-up failed");
          setBusy(false);
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError("Invalid email or password");
        setBusy(false);
        return;
      }
      router.push(result?.url || callbackUrl);
    } catch (err) {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login-brand" aria-hidden="true">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src="/vippy-logo.webp" alt="" width={34} height={34} priority style={{ borderRadius: 8 }} />
          <b style={{ fontSize: 16, fontWeight: 800 }}>Vippy Spend</b>
        </div>
        <div>
          <h2 style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em", maxWidth: "16ch" }}>
            Every card charge, matched to its receipt.
          </h2>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, marginTop: 24, fontSize: 14, opacity: 0.92 }}>
            <li>Charges sync from HDFC alerts in Gmail</li>
            <li>Receipts arrive by Telegram and match themselves</li>
            <li>The statement is reconciled and packaged for accounts</li>
          </ul>
        </div>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Vippy Industries · internal</span>
      </aside>

      <main className="login-form">
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div className="login-mobile-logo">
            <Image src="/vippy-logo.webp" alt="Vippy" width={44} height={44} priority style={{ borderRadius: 10 }} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>{mode === "signup" ? "Create your account" : "Sign in"}</h1>
          <p className="small muted" style={{ marginTop: 4, marginBottom: 24 }}>
            {mode === "signup" ? "Use your work email." : "Welcome back. Use Google to keep Gmail sync connected."}
          </p>

          <button type="button" className="btn lg block" onClick={() => signIn("google", { callbackUrl })}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
          <p className="small muted" style={{ marginTop: 8, textAlign: "center" }}>Also grants read access to Gmail for syncing charges.</p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0", color: "var(--text-muted)", fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            or with email
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          {error && (
            <div id="form-error" role="alert" className="banner bad" style={{ marginBottom: 14, padding: "10px 12px" }}>
              <span className="small" style={{ color: "var(--danger)", fontWeight: 600 }}>{error}</span>
            </div>
          )}

          <form onSubmit={handleCredentials} className="stack" style={{ gap: 14 }}>
            {mode === "signup" && (
              <label className="field" htmlFor="name">
                <span>Name <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></span>
                <input id="name" className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
            )}
            <label className="field" htmlFor="email">
              <span>Work email</span>
              <input id="email" className="input" type="email" placeholder="you@vipindustries.com" value={email} onChange={(e) => setEmail(e.target.value)} required
                aria-invalid={!!error} aria-describedby={error ? "form-error" : undefined} autoComplete="email" />
            </label>
            <label className="field" htmlFor="password">
              <span>Password</span>
              <input id="password" className="input" type="password" placeholder={mode === "signup" ? "At least 8 characters" : ""} value={password} onChange={(e) => setPassword(e.target.value)} required
                minLength={mode === "signup" ? 8 : undefined} aria-invalid={!!error} aria-describedby={error ? "form-error" : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </label>
            <button type="submit" className="btn primary lg block" disabled={busy}>
              {busy ? "Signing in…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="small muted" style={{ textAlign: "center", marginTop: 16 }}>
            {mode === "signin" ? "No account yet? " : "Already have an account? "}
            <button type="button" className="link" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}>
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
