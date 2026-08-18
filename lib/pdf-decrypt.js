import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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

/**
 * qpdf's emscripten glue reads `process.argv[1]` and calls `.replace` on it as
 * it loads. Vercel's runtime leaves a *number* there, so every statement ingest
 * died with "75707.replace is not a function" in production while passing
 * locally, where argv[1] is a script path. Nothing in this call chain cares
 * what argv says, so it is stringified for the duration and put back.
 */
/**
 * Where qpdf's .wasm actually is.
 *
 * The obvious `require.resolve("@jspawn/qpdf-wasm")` is rewritten by the
 * bundler into a numeric module id, so deriving the path from it produced
 * "75707.replace is not a function" in production while working perfectly
 * locally, where resolve returns a filename. A literal `.wasm` import is no
 * better: a bundler tries to compile it as a module, and this is data read at
 * runtime.
 *
 * So the file is looked for by path. The package stays external and is traced
 * into the deployment by `next.config.mjs`.
 */
function wasmPath() {
  const candidates = [];

  // Still the best answer when it really is a path rather than a module id.
  try {
    const resolved = require.resolve("@jspawn/qpdf-wasm");
    if (typeof resolved === "string") candidates.push(resolved.replace(/\.js$/, ".wasm"));
  } catch {
    // Nothing to add; the paths below are the fallback.
  }

  candidates.push(
    join(process.cwd(), "node_modules/@jspawn/qpdf-wasm/qpdf.wasm"),
    fileURLToPath(new URL("../node_modules/@jspawn/qpdf-wasm/qpdf.wasm", import.meta.url))
  );

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`Could not find qpdf.wasm. Looked in: ${candidates.join(", ")}`);
  }
  return found;
}

function withStringArgv(fn) {
  const real = process.argv;
  const needsFixing = real.some((a) => typeof a !== "string");
  if (!needsFixing) return fn();

  process.argv = real.map(String);
  try {
    return fn();
  } finally {
    process.argv = real;
  }
}

async function loadQpdf(onErrByte) {
  const createModule = withStringArgv(() => require("@jspawn/qpdf-wasm"));
  const wasmBinary = readFileSync(wasmPath());

  return withStringArgv(() =>
    createModule({
      noInitialRun: true,
      // This build wires its console through the emscripten FS streams rather
      // than print/printErr, so diagnostics arrive one character at a time.
      stdout: () => {},
      stderr: onErrByte,
      // The published build resolves its .wasm with fetch(), which cannot take
      // a filesystem path under Node. Handing it the bytes sidesteps that.
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module));
        return {};
      },
    })
  );
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
