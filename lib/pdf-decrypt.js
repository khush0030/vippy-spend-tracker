import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

/**
 * Opening HDFC's password-protected e-statement.
 *
 * qpdf compiled to WASM, so this works on serverless where a native binary
 * cannot be shipped. The password comes from `card_accounts.statement_password`
 * and is never logged — a wrong one produces a generic failure, not an echo.
 *
 * A fresh module instance is built per call: emscripten's runtime exits with
 * the program, so reusing one across invocations is not safe. Statements are
 * monthly, so the ~1 MB compile is irrelevant.
 */

const require = createRequire(import.meta.url);

// Only the first kilobytes matter — /Encrypt lives in the trailer, but the
// dictionary itself appears in the body, so the whole buffer is scanned.
export function isEncryptedPdf(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return buffer.includes(Buffer.from("/Encrypt"));
}

export function isPdf(buffer) {
  return Boolean(buffer) && buffer.length > 4 && buffer.subarray(0, 5).toString() === "%PDF-";
}

async function loadQpdf(onErrByte) {
  const createModule = require("@jspawn/qpdf-wasm");
  // Derived from the resolved JS entry rather than resolved directly: a bundler
  // that sees a literal `.wasm` specifier tries to compile it as a module, and
  // this one is data loaded at runtime. `next.config.mjs` traces it into the
  // deployment by path.
  const wasmBinary = readFileSync(require.resolve("@jspawn/qpdf-wasm").replace(/\.js$/, ".wasm"));

  return createModule({
    noInitialRun: true,
    // This build wires its console through the emscripten FS streams rather
    // than print/printErr, so diagnostics arrive one character at a time.
    stdout: () => {},
    stderr: onErrByte,
    // The published build resolves its .wasm with fetch(), which cannot take a
    // filesystem path under Node. Handing it the bytes sidesteps that entirely.
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module));
      return {};
    },
  });
}

/**
 * Returns a decrypted copy. An unencrypted PDF is passed straight through, so
 * callers never have to ask which kind they were sent.
 */
export async function decryptPdf(buffer, password) {
  if (!isPdf(buffer)) throw new Error("Not a PDF");
  if (!isEncryptedPdf(buffer)) return buffer;

  let stderr = "";
  const mod = await loadQpdf((code) => {
    if (code != null) stderr += String.fromCharCode(code);
  });

  const IN = "/in.pdf";
  const OUT = "/out.pdf";
  mod.FS.writeFile(IN, buffer);

  // qpdf's non-zero exit propagates into the host process's own exit code,
  // which would fail an otherwise-green test run or a healthy request handler.
  const hostExitCode = process.exitCode;

  let status = 0;
  try {
    status = mod.callMain([`--password=${password ?? ""}`, "--decrypt", IN, OUT]);
  } catch (err) {
    // Emscripten signals a non-zero exit by throwing.
    status = err?.status ?? 2;
  } finally {
    process.exitCode = hostExitCode;
  }

  // qpdf exits 3 on warnings — a statement that opened but had a malformed
  // object still gives us a readable document.
  if (status !== 0 && status !== 3) {
    if (/invalid password/i.test(stderr)) {
      throw new Error("Statement password rejected by the PDF.");
    }
    throw new Error(`Could not decrypt the statement (qpdf exit ${status}).`);
  }

  let out;
  try {
    out = Buffer.from(mod.FS.readFile(OUT));
  } catch {
    throw new Error("Decryption produced no output.");
  }

  if (!isPdf(out)) throw new Error("Decryption produced something that is not a PDF.");
  return out;
}
