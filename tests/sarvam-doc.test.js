// tests/sarvam-doc.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractFields, digitise, pickResultFile } from "../lib/sarvam-doc.js";

async function zipWith(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * A fake Sarvam: records every request, answers the job lifecycle in order.
 * `statuses` is the sequence returned by successive status polls.
 */
function fakeSarvam({ statuses, zip }) {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/job/extract") || url.endsWith("/job/digitise")) {
      return { ok: true, status: 200, json: async () => ({ job_id: "job1", status: "pending" }) };
    }
    if (url.endsWith("/job/job1/status")) {
      const status = statuses[Math.min(polls++, statuses.length - 1)];
      return { ok: true, status: 200, json: async () => ({ status }) };
    }
    if (url.endsWith("/job/job1/download-url")) {
      return { ok: true, status: 200, json: async () => ({ method: "GET", url: "https://files.example/out.zip" }) };
    }
    if (url === "https://files.example/out.zip") {
      return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetch, calls, sleep: async () => {} };
}

test("the primary result file is the top-level one, never the manifest or page metadata", () => {
  const names = ["manifest.json", "metadata/page_001.json", "output.json"];
  assert.equal(pickResultFile(names, "json"), "output.json");
  assert.equal(pickResultFile(["manifest.json", "doc.md", "metadata/page_001.json"], "md"), "doc.md");
  assert.throws(() => pickResultFile(["manifest.json"], "json"), /no \.json result/);
});

test("extractFields submits the schema, polls to completion and returns the parsed JSON", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "manifest.json": "{}", "output.json": JSON.stringify({ total: 957, currency: "INR" }) });
  const sarvam = fakeSarvam({ statuses: ["pending", "running", "completed"], zip });
  const schema = { type: "object", properties: { total: { type: "number" } } };

  const out = await extractFields(Buffer.from("pdf"), "application/pdf", { schema, ...sarvam });

  assert.deepEqual(out, { total: 957, currency: "INR" });
  const create = sarvam.calls[0];
  assert.equal(create.url, "https://api.sarvam.ai/doc-ai/v1/job/extract");
  assert.equal(create.init.headers["api-subscription-key"], "sk-test");
  assert.equal(create.init.body.get("schema"), JSON.stringify(schema));
  assert.equal(create.init.body.get("output_format"), "json");
  assert.equal(create.init.body.get("language"), "en-IN");
  assert.equal(create.init.body.get("file").type, "application/pdf");
  assert.equal(sarvam.calls.filter((c) => c.url.endsWith("/status")).length, 3);
  const download = sarvam.calls.find((c) => c.url === "https://files.example/out.zip");
  assert.equal(download.init.method, "GET");
});

test("digitise asks for markdown and returns the markdown file", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "manifest.json": "{}", "metadata/page_001.json": "{}", "document.md": "# Statement\n| a | b |" });
  const sarvam = fakeSarvam({ statuses: ["completed"], zip });

  const md = await digitise(Buffer.from("pdf"), "application/pdf", sarvam);

  assert.equal(md, "# Statement\n| a | b |");
  assert.equal(sarvam.calls[0].url, "https://api.sarvam.ai/doc-ai/v1/job/digitise");
  assert.equal(sarvam.calls[0].init.body.get("output_format"), "md");
});

test("anything but completed is a failure — a partial read is not a second opinion", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "output.json": "{}" });
  for (const status of ["failed", "rejected", "partially_completed"]) {
    const sarvam = fakeSarvam({ statuses: [status], zip });
    await assert.rejects(
      extractFields(Buffer.from("x"), "image/jpeg", { schema: {}, ...sarvam }),
      new RegExp(`sarvam doc-ai job ${status}`)
    );
  }
});

test("a job that never finishes times out", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "output.json": "{}" });
  const sarvam = fakeSarvam({ statuses: ["running"], zip });
  let now = 0;
  await assert.rejects(
    extractFields(Buffer.from("x"), "image/jpeg", {
      schema: {}, ...sarvam, timeoutMs: 1000, now: () => (now += 400),
    }),
    /timed out after 1000ms/
  );
});

test("a missing api key is reported before any request", async () => {
  delete process.env.SARVAM_API_KEY;
  const sarvam = fakeSarvam({ statuses: [], zip: Buffer.alloc(0) });
  await assert.rejects(digitise(Buffer.from("x"), "image/png", sarvam), /SARVAM_API_KEY is not set/);
  assert.equal(sarvam.calls.length, 0);
});
