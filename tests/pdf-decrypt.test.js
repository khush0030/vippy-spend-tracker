import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decryptPdf, isEncryptedPdf, isPdf } from "../lib/pdf-decrypt.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(join(here, "fixtures", n));

// Password matches how tests/fixtures/encrypted.pdf was generated.
const PASSWORD = "Vippy1234";

describe("isEncryptedPdf", () => {
  test("tells the two fixtures apart", () => {
    assert.equal(isEncryptedPdf(fixture("encrypted.pdf")), true);
    assert.equal(isEncryptedPdf(fixture("plain.pdf")), false);
  });

  test("does not mistake arbitrary bytes for a PDF", () => {
    assert.equal(isPdf(Buffer.from("hello")), false);
    assert.equal(isPdf(fixture("plain.pdf")), true);
  });
});

describe("decryptPdf", () => {
  test("opens a password-protected statement", async () => {
    const out = await decryptPdf(fixture("encrypted.pdf"), PASSWORD);
    assert.equal(isPdf(out), true);
    assert.equal(isEncryptedPdf(out), false);
  });

  test("passes an unencrypted PDF straight through", async () => {
    const plain = fixture("plain.pdf");
    const out = await decryptPdf(plain, PASSWORD);
    assert.equal(out, plain);
  });

  test("says the password was rejected rather than echoing it", async () => {
    await assert.rejects(
      () => decryptPdf(fixture("encrypted.pdf"), "wrong-password"),
      (err) => {
        assert.match(err.message, /password/i);
        assert.doesNotMatch(err.message, /wrong-password/);
        return true;
      }
    );
  });

  test("refuses anything that is not a PDF", async () => {
    await assert.rejects(() => decryptPdf(Buffer.from("not a pdf"), PASSWORD), /Not a PDF/);
  });
});
