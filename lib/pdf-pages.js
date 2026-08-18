import { loadQpdf, isPdf } from "./pdf-decrypt.js";

/**
 * Reading a statement in pieces.
 *
 * A year's worth of spending runs to 224 rows and about 27,000 output tokens,
 * which takes a single model call some four minutes. The serverless function it
 * runs in is allowed five, and the tie-out retry would need another four — so
 * the whole statement in one call cannot fit, and would fail as a timeout rather
 * than as anything diagnosable.
 *
 * Page ranges solve it twice over: four short calls run at once instead of one
 * long one, and each call sees a handful of pages rather than thirteen, which
 * is a easier question to answer accurately.
 *
 * qpdf is already here to open the encrypted original, and it splits pages too,
 * so this costs no new dependency.
 */

/**
 * Pages per call.
 *
 * Three, not four: the opening pages of a statement carry the densest listing,
 * and a four-page slice of them ran past a 16k output ceiling mid-JSON. Three
 * keeps every slice inside its budget with room to spare, and five short calls
 * in parallel still finish faster than two long ones.
 */
export const PAGES_PER_CHUNK = 3;

/** `[{from, to}]`, one-based and inclusive, as qpdf and humans both count. */
export function planChunks(pages, size = PAGES_PER_CHUNK) {
  const total = Math.floor(Number(pages));
  if (!Number.isFinite(total) || total < 1) return [];

  // A size of zero would never advance.
  const step = Math.max(1, Math.floor(Number(size) || 0));

  const out = [];
  for (let from = 1; from <= total; from += step) {
    out.push({ from, to: Math.min(from + step - 1, total) });
  }
  return out;
}

/**
 * Run qpdf over one input file and return the bytes it wrote, or null when it
 * wrote nothing. `args` receives the in and out paths already mounted.
 */
async function runQpdf(pdf, buildArgs, { wantOutput = true } = {}) {
  if (!isPdf(pdf)) throw new Error("Not a PDF");

  let stdout = "";
  let stderr = "";
  const mod = await loadQpdf({
    onOut: (code) => {
      if (code != null) stdout += String.fromCharCode(code);
    },
    onErr: (code) => {
      if (code != null) stderr += String.fromCharCode(code);
    },
  });

  const IN = "/in.pdf";
  const OUT = "/out.pdf";
  mod.FS.writeFile(IN, pdf);

  // qpdf's exit code otherwise becomes the host process's, failing a green test
  // run or a healthy request.
  const hostExitCode = process.exitCode;
  let status = 0;
  try {
    status = mod.callMain(buildArgs(IN, OUT));
  } catch (err) {
    status = err?.status ?? 2;
  } finally {
    process.exitCode = hostExitCode;
  }

  // 3 is a warning: a readable document with a malformed object in it.
  if (status !== 0 && status !== 3) {
    throw new Error(`qpdf failed (exit ${status})${stderr ? `: ${stderr.trim()}` : ""}`);
  }

  if (!wantOutput) return { stdout, stderr };

  const out = Buffer.from(mod.FS.readFile(OUT));
  if (!isPdf(out)) throw new Error("qpdf produced something that is not a PDF");
  return { pdf: out, stdout, stderr };
}

/**
 * How many pages the statement has.
 *
 * Asked of qpdf rather than parsed out of the file: a linearised PDF states its
 * page count in more than one place and they do not have to agree.
 */
export async function pageCount(pdf) {
  const { stdout } = await runQpdf(pdf, (IN) => ["--show-npages", IN], { wantOutput: false });

  const n = Number.parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(n) || n < 1) throw new Error("Could not count the pages of the statement");
  return n;
}

/**
 * `[{ from, to, pdf }]` — the statement as several smaller PDFs.
 *
 * A statement short enough to read in one call is returned as a single chunk of
 * the original, without a pointless round trip through qpdf.
 */
export async function splitIntoChunks(pdf, size = PAGES_PER_CHUNK) {
  const pages = await pageCount(pdf);
  const ranges = planChunks(pages, size);

  if (ranges.length <= 1) return [{ from: 1, to: pages, pdf }];

  const out = [];
  for (const range of ranges) {
    const { pdf: slice } = await runQpdf(pdf, (IN, OUT) => [
      "--empty",
      "--pages",
      IN,
      `${range.from}-${range.to}`,
      "--",
      OUT,
    ]);
    out.push({ ...range, pdf: slice });
  }
  return out;
}
