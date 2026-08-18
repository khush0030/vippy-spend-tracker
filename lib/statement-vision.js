import Anthropic from "@anthropic-ai/sdk";
import {
  normalizeStatementLine,
  sumByDirection,
  controlTotal,
  mergeChunkReads,
} from "@/lib/statement-lines";
import { splitIntoChunks } from "@/lib/pdf-pages";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * Reading the statement PDF.
 *
 * Receipts are read by two model families because there is no independent
 * check on a photograph of a bill. A statement carries its own check: opening
 * balance plus debits minus credits minus payments must reproduce the printed
 * closing balance. So instead of paying for a second opinion, the read is
 * verified arithmetically and re-read once — with the shortfall quoted back —
 * if it does not balance.
 */

const MODEL = process.env.STATEMENT_MODEL || "claude-opus-5";

/**
 * Where to go when the first model has no capacity.
 *
 * Safe in a way a fallback usually is not: the statement carries its own proof.
 * Opening balance plus debits minus credits minus payments must reproduce the
 * printed closing balance, and a read that fails to balance is rejected no
 * matter which model produced it. So the fallback cannot lower accuracy, only
 * availability — and a statement that arrives on a day the provider is busy
 * still gets read.
 */
const MODEL_FALLBACK = process.env.STATEMENT_MODEL_FALLBACK || "claude-sonnet-5";
const MAX_ATTEMPTS = 2;

/**
 * How long the whole read may take before a second attempt is abandoned.
 *
 * The function it runs in is allowed 300 seconds and a full pass takes about
 * 160, so re-reading everything can overrun — and a timeout loses the pass that
 * did complete, along with any record of why. Better to keep the first read,
 * report that it did not balance, and let the next day's run try again: ingest
 * is attempted on three consecutive days for exactly this reason.
 */
const DEADLINE_MS = Number(process.env.STATEMENT_DEADLINE_MS || 200000);

/** Transient upstream conditions worth waiting out rather than failing on. */
const RETRYABLE = /overloaded|rate.?limit|429|50[0234]|timeout|ECONNRESET/i;
const API_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One read, retried through a provider having a bad minute.
 *
 * The statement job runs on three consecutive days, so a genuine outage is not
 * fatal — but an "Overloaded" on the first of a fan-out would otherwise waste
 * the other reads that succeeded alongside it.
 */
async function withRetry(label, fn) {
  let last;
  for (let attempt = 1; attempt <= API_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!RETRYABLE.test(String(err?.message || ""))) throw err;
      if (attempt === API_ATTEMPTS) break;
      await sleep(2000 * attempt);
    }
  }
  throw new Error(`${label}: ${last?.message || "read failed"}`);
}

let _client = null;
function anthropic() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const SYSTEM_PROMPT = `You transcribe credit card statements into JSON. You are a transcriber, not an analyst: copy what is printed, never infer, never round, never tidy up a merchant name.

Return ONE JSON object, no prose, no markdown fence:

{
  "cardLast4": "1234" | null,
  "statementDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "periodStart": "YYYY-MM-DD" | null,
  "periodEnd": "YYYY-MM-DD" | null,
  "openingBalance": number | null,
  "closingBalance": number | null,
  "totalDebits": number | null,
  "totalCredits": number | null,
  "minimumDue": number | null,
  "lines": [
    {
      "date": "YYYY-MM-DD",
      "postDate": "YYYY-MM-DD" | null,
      "description": "exactly as printed",
      "amount": number,
      "direction": "debit" | "credit",
      "currency": "EUR" | null,
      "amountOriginal": number | null
    }
  ]
}

Rules:
1. EVERY transaction row on EVERY page. Do not summarise, do not truncate, do not skip repeats. Reward points rows are not transactions; balances carried forward are not transactions.
2. "amount" is always POSITIVE. Direction goes in "direction". A row marked Cr, CR, or with a trailing minus is a "credit"; everything else is a "debit".
3. Copy amounts digit for digit. Indian statements group as 1,58,204.00 — that is 158204.00.
4. Dates on Indian statements are usually DD/MM/YYYY. Convert to YYYY-MM-DD. Never swap day and month.
5. Foreign charges print the origin amount too. Put the INR amount charged in "amount", the origin currency code in "currency" and the origin amount in "amountOriginal". If the row is in INR, both are null.
6. Fees, taxes, interest and payments to the card are all rows. Include them exactly as printed.
7. If a value genuinely is not on the statement, use null. Never invent one.`;

function parseJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function readOnce(pdf, note, pageLabel = null, model = MODEL) {
  // Truncation produces invalid JSON rather than a short answer, so the ceiling
  // is generous for the few pages this call covers, and the call streams: the
  // SDK refuses a non-streaming request whose max_tokens implies more than ten
  // minutes of generation.
  const res = await anthropic().messages.stream({
    model,
    max_tokens: 24000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
          },
          {
            type: "text",
            text: [
              pageLabel
                ? `Transcribe pages ${pageLabel} of this statement. They are one slice of a longer document: transcribe every transaction row on these pages, and give header figures only where they are actually printed here.`
                : "Transcribe this statement.",
              note,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
    ],
  }).finalMessage();

  if (res.stop_reason === "max_tokens") {
    throw new Error("Statement transcription hit the output ceiling — the JSON is incomplete.");
  }

  const text = (res.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return parseJson(text);
}

/**
 * Returns `{ header, lines, control, attempts }` where `lines` are already
 * normalised and classified. `control.tiesOut` is the signal downstream: a
 * statement that does not balance is a statement we have not fully read.
 */
export async function parseStatement(pdf, { userId } = {}) {
  // A whole statement in one call takes about four minutes and 27k output
  // tokens — longer than the function is allowed to live, and long before the
  // tie-out retry gets a turn. Read a few pages at a time instead, all at once.
  const chunks = await splitIntoChunks(pdf);

  let note = null;
  let last = null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1 && Date.now() - startedAt > DEADLINE_MS) {
      await logWarn({
        source: "statement",
        event: "retry_skipped",
        userId,
        message: `First read took ${Math.round((Date.now() - startedAt) / 1000)}s; not re-reading inside this invocation`,
      });
      break;
    }

    const reads = await Promise.all(
      chunks.map(async (chunk) => {
        const label = `${chunk.from}-${chunk.to}`;
        const slice = chunks.length > 1 ? label : null;
        try {
          let json;
          try {
            json = await withRetry(`pages ${label}`, () => readOnce(chunk.pdf, note, slice));
          } catch (err) {
            if (!RETRYABLE.test(String(err?.message || ""))) throw err;
            await logWarn({
              source: "statement",
              event: "model_fallback",
              userId,
              message: `${MODEL} had no capacity for pages ${label}; falling back to ${MODEL_FALLBACK}`,
            });
            json = await withRetry(`pages ${label} (${MODEL_FALLBACK})`, () =>
              readOnce(chunk.pdf, note, slice, MODEL_FALLBACK)
            );
          }
          return { ...chunk, json };
        } catch (err) {
          await logWarn({
            source: "statement",
            event: "chunk_failed",
            userId,
            message: `Pages ${label} could not be read: ${err.message}`,
          });
          return { ...chunk, json: null };
        }
      })
    );

    const json = mergeChunkReads(reads);

    // Pages we never read cannot be made up for by the ones we did: the tie-out
    // would fail anyway, and a statement short of four pages must not pass for
    // a whole one.
    if (json.unread.length) {
      note = `Pages ${json.unread.join(", ")} came back unreadable last time. Transcribe them completely.`;
      last = {
        header: header(json),
        lines: [],
        control: { tiesOut: false, diff: null },
        attempts: attempt,
        unread: json.unread,
      };
      continue;
    }

    if (!json.lines.length) {
      note = "Your previous answer contained no transaction rows. Return only the JSON object, with every row.";
      last = { header: {}, lines: [], control: { tiesOut: false, diff: null }, attempts: attempt };
      continue;
    }

    const lines = json.lines.map((l, i) => normalizeStatementLine(l, i));
    const totals = sumByDirection(lines);
    const control = controlTotal({
      opening: json.openingBalance,
      closing: json.closingBalance,
      ...totals,
    });

    last = { header: header(json), lines, totals, control, attempts: attempt, raw: json };

    if (control.tiesOut) {
      await logInfo({
        source: "statement",
        event: "parsed",
        userId,
        message: `Statement read on attempt ${attempt} in ${chunks.length} part(s): ${lines.length} lines, ties out`,
      });
      return last;
    }

    await logWarn({
      source: "statement",
      event: "tie_out_failed",
      userId,
      message: `Attempt ${attempt} did not balance (diff ${control.diff})`,
      details: { lines: lines.length, ...totals },
    });

    note = [
      "Your previous transcription did not balance.",
      `Across the statement you returned ${lines.length} rows totalling ${totals.debits} in debits, ${totals.credits} in credits and ${totals.payments} in payments.`,
      `opening ${json.openingBalance} + debits − credits − payments = ${control.expected}, but the statement prints a closing balance of ${json.closingBalance}.`,
      `That is a gap of ${control.diff}.`,
      "Almost always this means a row was missed, a row was duplicated, or a Cr marker was read as a debit. Re-read your pages line by line and return the complete list.",
    ].join(" ");
  }

  return last;
}

function header(json) {
  return {
    cardLast4: json.cardLast4 ?? null,
    statementDate: json.statementDate ?? null,
    dueDate: json.dueDate ?? null,
    periodStart: json.periodStart ?? null,
    periodEnd: json.periodEnd ?? null,
    openingBalance: num(json.openingBalance),
    closingBalance: num(json.closingBalance),
    totalDebits: num(json.totalDebits),
    totalCredits: num(json.totalCredits),
    minimumDue: num(json.minimumDue),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
