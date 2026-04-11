"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg)" }} />}>
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
      setError(err.message || "Something went wrong");
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: "var(--radius)",
    border: "1px solid var(--border)", background: "var(--bg-secondary)",
    color: "var(--text)", fontSize: 14, outline: "none",
    transition: "border-color 0.15s, background 0.15s",
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg)", padding: 16,
    }}>
      <div style={{
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
        padding: "40px 32px", border: "1px solid var(--border)",
        maxWidth: 400, width: "100%",
        boxShadow: "var(--shadow-hover)",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", overflow: "hidden", background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
          }}>
            <Image src="/vippy-logo.webp" alt="Vippy" width={72} height={72} priority style={{ objectFit: "contain" }} />
          </div>

          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5 }}>Vippy Spend Tracker</div>
          <div style={{
            fontSize: 12, color: "var(--text-tertiary)", marginTop: 6, marginBottom: 24,
            padding: "4px 12px", background: "var(--bg-secondary)", borderRadius: 20,
            display: "inline-block", border: "1px solid var(--border)",
          }}>
            Vippy Industries &middot; Internal
          </div>
        </div>

        {error && (
          <div style={{
            background: "var(--bg-secondary)", border: "1px solid var(--danger)",
            color: "var(--danger)", fontSize: 12, padding: "9px 12px",
            borderRadius: "var(--radius)", marginBottom: 14, lineHeight: 1.5,
          }}>{error}</div>
        )}

        <form onSubmit={handleCredentials} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              autoComplete="name"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
            autoComplete="email"
          />
          <input
            type="password"
            placeholder={mode === "signup" ? "Password (min 8 chars)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "signup" ? 8 : undefined}
            style={inputStyle}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%", padding: "11px 24px", borderRadius: "var(--radius)",
              border: "none", background: "var(--accent)", color: "#fff",
              fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1, marginTop: 4,
              transition: "opacity 0.15s, transform 0.05s",
            }}
          >
            {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--text-tertiary)" }}>
          {mode === "signin" ? "No account? " : "Already have one? "}
          <button
            type="button"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}
            style={{
              background: "none", border: "none", color: "var(--accent)",
              fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0,
            }}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 10, margin: "20px 0 14px",
          color: "var(--text-tertiary)", fontSize: 11,
        }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          OR
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          style={{
            width: "100%", padding: "11px 24px", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", background: "var(--bg-card)",
            fontSize: 14, fontWeight: 500, color: "var(--text)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            cursor: "pointer", boxShadow: "var(--shadow)",
            transition: "background 0.15s, box-shadow 0.15s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.boxShadow = "var(--shadow-hover)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-card)"; e.currentTarget.style.boxShadow = "var(--shadow)"; }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 18, lineHeight: 1.5, textAlign: "center" }}>
          Google sign-in also grants Gmail read access for transaction syncing.
        </p>
      </div>
    </div>
  );
}
