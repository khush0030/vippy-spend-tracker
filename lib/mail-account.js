import { getSupabaseAdmin } from "./supabase.js";
import { encryptSecret, decryptSecret } from "./secret-box.js";

/**
 * Connected mailboxes and their credentials.
 *
 * Two accounts, connected two different ways, because Google will not permit
 * one. gmail.readonly is a restricted scope: publishing the consent screen to
 * production would mean an annual third-party penetration test, and leaving it
 * in testing expires refresh tokens weekly. So the Workspace account uses an
 * Internal consent screen, which is exempt from both, and the personal account
 * uses an IMAP app password, which sidesteps OAuth altogether.
 *
 * Credentials are ciphertext here and plaintext nowhere except in the moment
 * an adapter opens a connection.
 */

const SELECT = "id, user_id, email, auth_kind, role, status, last_harvest_at, last_checked_at, created_at";

/** Cookie carrying the OAuth `state` between GET /api/mail-accounts and the callback. */
export const OAUTH_STATE_COOKIE = "mailbox_oauth_state";

export function normaliseEmail(input) {
  const value = String(input ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** Google shows app passwords as four groups of four. People paste them that way. */
export function normaliseAppPassword(input) {
  const value = String(input ?? "").replace(/\s+/g, "");
  return /^[a-z]{16}$/i.test(value) ? value.toLowerCase() : null;
}

export function validateAccountInput({ email, auth_kind: authKind, credential, role = "invoices" } = {}) {
  const errors = [];

  if (!normaliseEmail(email)) errors.push("A valid email address is required.");

  if (authKind !== "oauth" && authKind !== "imap_app_password") {
    errors.push("auth_kind must be 'oauth' or 'imap_app_password'.");
  }

  if (!String(credential ?? "").trim()) {
    errors.push("A credential is required.");
  } else if (authKind === "imap_app_password" && !normaliseAppPassword(credential)) {
    errors.push("An app password is sixteen letters, as shown at myaccount.google.com/apppasswords.");
  }

  // Bank alerts and the statement PDF are fetched through the Gmail API, so
  // the primary mailbox cannot be one that only speaks IMAP.
  if (role === "primary" && authKind === "imap_app_password") {
    errors.push("The primary mailbox must be connected with OAuth, not an app password.");
  }

  return { ok: errors.length === 0, errors };
}

export async function listMailAccounts(userId) {
  const { data } = await getSupabaseAdmin()
    .from("mail_accounts")
    .select(SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return data || [];
}

/** With the credential decrypted. Only an adapter should call this. */
export async function getMailAccount(userId, id) {
  const { data } = await getSupabaseAdmin()
    .from("mail_accounts")
    .select(`${SELECT}, credential`)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  return { ...data, credential: decryptSecret(data.credential) };
}

export async function primaryMailAccount(userId) {
  const { data } = await getSupabaseAdmin()
    .from("mail_accounts")
    .select(`${SELECT}, credential`)
    .eq("user_id", userId)
    .eq("role", "primary")
    .maybeSingle();

  if (!data) return null;
  return { ...data, credential: decryptSecret(data.credential) };
}

export async function saveMailAccount(userId, input) {
  const check = validateAccountInput(input);
  if (!check.ok) throw new Error(check.errors.join(" "));

  const credential =
    input.auth_kind === "imap_app_password"
      ? normaliseAppPassword(input.credential)
      : String(input.credential).trim();

  const { data, error } = await getSupabaseAdmin()
    .from("mail_accounts")
    .upsert(
      {
        user_id: userId,
        email: normaliseEmail(input.email),
        auth_kind: input.auth_kind,
        credential: encryptSecret(credential),
        role: input.role || "invoices",
        status: "active",
      },
      { onConflict: "user_id,email" }
    )
    .select(SELECT)
    .single();

  // The partial unique index rejects a second primary. Say so in English.
  if (error) {
    if (/mail_accounts_one_primary/.test(error.message)) {
      throw new Error("Another mailbox is already the primary one. Demote it first.");
    }
    throw new Error(`Could not save the mailbox: ${error.message}`);
  }
  return data;
}

export async function removeMailAccount(userId, id) {
  const { error } = await getSupabaseAdmin()
    .from("mail_accounts")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`Could not remove the mailbox: ${error.message}`);
}

async function setStatus(userId, id, status) {
  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("mail_accounts")
    .select("status")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  const { error } = await sb
    .from("mail_accounts")
    .update({ status, last_checked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`Could not update mailbox status: ${error.message}`);

  // Whether this was a transition, so a caller can alert once rather than daily.
  return Boolean(before) && before.status !== status;
}

export const markRevoked = (userId, id) => setStatus(userId, id, "revoked");
export const markActive = (userId, id) => setStatus(userId, id, "active");
