import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseEmail, normaliseAppPassword, validateAccountInput } from "../lib/mail-account.js";

test("email is lowercased and trimmed", () => {
  assert.equal(normaliseEmail("  KMutha@VippySoya.com "), "kmutha@vippysoya.com");
});

test("nonsense is not an email", () => {
  assert.equal(normaliseEmail("not-an-email"), null);
  assert.equal(normaliseEmail(""), null);
  assert.equal(normaliseEmail(null), null);
});

test("app passwords lose the spaces Google shows them with", () => {
  // Google displays "abcd efgh ijkl mnop"; users paste it exactly like that.
  assert.equal(normaliseAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.equal(normaliseAppPassword("abcdefghijklmnop"), "abcdefghijklmnop");
});

test("an app password is sixteen letters or it is not one", () => {
  assert.equal(normaliseAppPassword("abcd efgh ijkl"), null);
  assert.equal(normaliseAppPassword("abcd efgh ijkl mnop qrst"), null);
  assert.equal(normaliseAppPassword("abcd1fgh ijkl mnop"), null);
});

test("a valid oauth account passes", () => {
  const r = validateAccountInput({
    email: "kmutha@vippysoya.com", auth_kind: "oauth", credential: "1//0abc", role: "primary",
  });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test("a valid app-password account passes", () => {
  const r = validateAccountInput({
    email: "khushmutha20@gmail.com", auth_kind: "imap_app_password",
    credential: "abcd efgh ijkl mnop", role: "invoices",
  });
  assert.equal(r.ok, true);
});

test("an app-password account may not be the primary mailbox", () => {
  // Bank alerts and the statement PDF are fetched over the Gmail API.
  const r = validateAccountInput({
    email: "khushmutha20@gmail.com", auth_kind: "imap_app_password",
    credential: "abcd efgh ijkl mnop", role: "primary",
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /primary/i.test(e)));
});

test("every fault is reported at once, not one at a time", () => {
  const r = validateAccountInput({ email: "nope", auth_kind: "carrier-pigeon", credential: "" });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
});
