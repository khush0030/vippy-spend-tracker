// lib/sarvam-doc.js
import JSZip from "jszip";

/**
 * Sarvam Document AI, hidden behind two plain functions.
 *
 * The API is a job: create it with a multipart upload, poll its status, ask
 * for a download URL, download a ZIP, open the one file inside that matters.
 * Callers see none of that. They hand over bytes and get back either the
 * extracted fields (Extract, schema-driven) or the page text (Digitise, OCR).
 *
 * Only `completed` is accepted. A `partially_completed` receipt read would be
 * a second opinion with pages missing, which is worse than no second opinion.
 *
 * No @/ imports; `fetch`, `sleep` and `now` are parameters so node --test can
 * drive the whole lifecycle without a network.
 */

const BASE = "https://api.sarvam.ai/doc-ai/v1/job";
const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);
const POLL_MS = 3000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickResultFile(names, ext) {
  const hit = names.find(
    (n) => n.endsWith(`.${ext}`) && n !== "manifest.json" && !n.startsWith("metadata/") && !n.includes("/")
  );
  if (!hit) throw new Error(`sarvam doc-ai download holds no .${ext} result (files: ${names.join(", ")})`);
  return hit;
}

function extensionFor(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  return "jpg";
}

async function runJob(kind, buffer, mime, fields, { language, timeoutMs, fetch, sleep, now }) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not set");
  const headers = { "api-subscription-key": key };

  const body = new FormData();
  body.set("file", new Blob([buffer], { type: mime }), `document.${extensionFor(mime)}`);
  body.set("language", language);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);

  const created = await fetch(`${BASE}/${kind}`, { method: "POST", headers, body });
  if (!created.ok) {
    const detail = await created.text?.().catch(() => "") ?? "";
    throw new Error(`sarvam doc-ai ${created.status}: ${String(detail).slice(0, 300)}`);
  }
  const { job_id: jobId } = await created.json();

  const startedAt = now();
  let status;
  for (;;) {
    const res = await fetch(`${BASE}/${jobId}/status`, { headers });
    if (!res.ok) throw new Error(`sarvam doc-ai status ${res.status}`);
    status = String((await res.json()).status || "").toLowerCase();
    if (TERMINAL.has(status)) break;
    if (now() - startedAt > timeoutMs) throw new Error(`sarvam doc-ai job timed out after ${timeoutMs}ms`);
    await sleep(POLL_MS);
  }
  if (status !== "completed") throw new Error(`sarvam doc-ai job ${status}`);

  const dl = await fetch(`${BASE}/${jobId}/download-url`, { headers });
  if (!dl.ok) throw new Error(`sarvam doc-ai download-url ${dl.status}`);
  const { method = "GET", url } = await dl.json();

  const file = await fetch(url, { method });
  if (!file.ok) throw new Error(`sarvam doc-ai download ${file.status}`);
  return JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
}

function options(opts = {}) {
  return {
    language: opts.language ?? "en-IN",
    timeoutMs: opts.timeoutMs ?? 120_000,
    fetch: opts.fetch ?? globalThis.fetch,
    sleep: opts.sleep ?? defaultSleep,
    now: opts.now ?? Date.now,
  };
}

/** Schema-driven field extraction. Returns the parsed JSON the schema shaped. */
export async function extractFields(buffer, mime, opts = {}) {
  if (!opts.schema) throw new Error("extractFields needs a schema");
  const zip = await runJob("extract", buffer, mime, {
    schema: JSON.stringify(opts.schema), output_format: "json",
  }, options(opts));
  const name = pickResultFile(Object.keys(zip.files), "json");
  return JSON.parse(await zip.file(name).async("string"));
}

/** Full-page OCR. Returns the document as markdown. */
export async function digitise(buffer, mime, opts = {}) {
  const zip = await runJob("digitise", buffer, mime, { output_format: "md" }, options(opts));
  const name = pickResultFile(Object.keys(zip.files), "md");
  return zip.file(name).async("string");
}
