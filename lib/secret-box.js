import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for the one secret this app has to keep reversible.
 *
 * The HDFC statement password must be replayed to qpdf, so it cannot be
 * hashed. Service-role access plus deny-all RLS already keeps it away from the
 * browser; this keeps it out of database backups and out of anything that gets
 * a read on the table.
 *
 * AES-256-GCM, random IV per write, authentication tag verified on read — a
 * tampered value fails loudly rather than decrypting to noise.
 *
 * The key lives in `STATEMENT_PW_KEY` (base64, 32 bytes). Losing it costs one
 * re-entry of the password in Settings, nothing more.
 */

const PREFIX = "v1";
const IV_BYTES = 12; // GCM's native nonce size
const KEY_BYTES = 32;

function key() {
  const raw = process.env.STATEMENT_PW_KEY;
  if (!raw) {
    throw new Error(
      "STATEMENT_PW_KEY is not set — required to store the statement password. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }

  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`STATEMENT_PW_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

export function hasEncryptionKey() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function generateEncryptionKey() {
  return randomBytes(KEY_BYTES).toString("base64");
}

/** Values written by this module are tagged, so legacy rows are recognisable. */
export function isCiphertext(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === "") return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);

  return [
    PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(":");
}

/**
 * Anything not written by this module is returned as-is: the column predates
 * encryption, so a hand-inserted plaintext password must keep working rather
 * than locking someone out of their own statement.
 */
export function decryptSecret(stored) {
  if (stored == null || stored === "") return null;
  if (!isCiphertext(stored)) return String(stored);

  const [, ivB64, tagB64, bodyB64] = String(stored).split(":");
  if (!ivB64 || !tagB64 || !bodyB64) {
    throw new Error("Stored secret could not be decrypted — the value is malformed.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Deliberately vague: a wrong key and a tampered value are the same story
    // to the caller, and neither should leak which.
    throw new Error(
      "Stored secret could not be decrypted — STATEMENT_PW_KEY may have changed. Re-enter the statement password in Settings."
    );
  }
}
