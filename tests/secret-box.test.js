import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  hasEncryptionKey,
  generateEncryptionKey,
  isCiphertext,
} from "../lib/secret-box.js";

const KEY = randomBytes(32).toString("base64");
let saved;

before(() => {
  saved = process.env.STATEMENT_PW_KEY;
  process.env.STATEMENT_PW_KEY = KEY;
});

after(() => {
  if (saved === undefined) delete process.env.STATEMENT_PW_KEY;
  else process.env.STATEMENT_PW_KEY = saved;
});

describe("generateEncryptionKey", () => {
  test("produces a key this module accepts", () => {
    const key = generateEncryptionKey();
    assert.equal(Buffer.from(key, "base64").length, 32);
  });
});

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a password", () => {
    const out = encryptSecret("TEST0000");
    assert.equal(decryptSecret(out), "TEST0000");
  });

  test("never stores the password in the open", () => {
    const out = encryptSecret("TEST0000");
    assert.doesNotMatch(out, /TEST0000/);
    assert.equal(isCiphertext(out), true);
  });

  test("encrypting the same password twice gives different ciphertext", () => {
    assert.notEqual(encryptSecret("same"), encryptSecret("same"));
  });

  test("survives a password with unicode and punctuation", () => {
    const pw = "Ström-2026#₹ç";
    assert.equal(decryptSecret(encryptSecret(pw)), pw);
  });

  test("refuses a tampered ciphertext rather than returning garbage", () => {
    const out = encryptSecret("TEST0000");
    const parts = out.split(":");
    // Flip a byte of the ciphertext body.
    const body = Buffer.from(parts[3], "base64");
    body[0] ^= 0xff;
    parts[3] = body.toString("base64");
    assert.throws(() => decryptSecret(parts.join(":")), /could not be decrypted/i);
  });

  test("a row written before encryption existed still reads", () => {
    // Legacy plaintext must keep working — the column predates this module.
    assert.equal(decryptSecret("TEST0000"), "TEST0000");
    assert.equal(isCiphertext("TEST0000"), false);
  });

  test("empty and null pass through untouched", () => {
    assert.equal(decryptSecret(null), null);
    assert.equal(decryptSecret(""), null);
  });
});

describe("without a key configured", () => {
  test("encrypting is refused, and says which variable to set", () => {
    const key = process.env.STATEMENT_PW_KEY;
    delete process.env.STATEMENT_PW_KEY;
    try {
      assert.equal(hasEncryptionKey(), false);
      assert.throws(() => encryptSecret("TEST0000"), /STATEMENT_PW_KEY/);
    } finally {
      process.env.STATEMENT_PW_KEY = key;
    }
  });

  test("a key of the wrong length is rejected, not silently padded", () => {
    const key = process.env.STATEMENT_PW_KEY;
    process.env.STATEMENT_PW_KEY = Buffer.from("too short").toString("base64");
    try {
      assert.throws(() => encryptSecret("x"), /32 bytes/);
    } finally {
      process.env.STATEMENT_PW_KEY = key;
    }
  });
});
