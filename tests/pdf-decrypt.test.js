import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Module from "node:module";
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
  test("finds its wasm even when require.resolve hands back a module id", async () => {
    // What a bundler does: rewrite require.resolve to a numeric id. Deriving
    // the .wasm path from that produced "75707.replace is not a function" in
    // production, and only in production.
    const real = Module.prototype.require;
    const realResolve = real.resolve;
    try {
      const patched = function (...args) {
        return real.apply(this, args);
      };
      patched.resolve = () => 75707;
      Module.prototype.require = patched;

      const out = await decryptPdf(fixture("encrypted.pdf"), PASSWORD);
      assert.equal(isPdf(out), true);
    } finally {
      real.resolve = realResolve;
      Module.prototype.require = real;
    }
  });

  test("opens a statement where the host runtime left a number in argv", async () => {
    // Vercel's Node runtime puts a number in process.argv[1], and qpdf's
    // emscripten glue calls .replace on it as the module loads. That crashed
    // every statement ingest in production while passing locally, where argv[1]
    // is a script path.
    const real = process.argv;
    process.argv = [real[0], 75707];
    try {
      const out = await decryptPdf(fixture("encrypted.pdf"), PASSWORD);
      assert.equal(isPdf(out), true);
    } finally {
      process.argv = real;
    }
  });

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
