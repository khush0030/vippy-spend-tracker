import Anthropic from "@anthropic-ai/sdk";
import { normalizeStatementLine, sumByDirection, controlTotal } from "@/lib/statement-lines";
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
const MAX_ATTEMPTS = 2;

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

async function readOnce(pdf, note) {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 16000,
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
            text: note
              ? `Transcribe this statement.\n\n${note}`
              : "Transcribe this statement.",
          },
        ],
      },
    ],
  });

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
  let note = null;
  let last = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const json = await readOnce(pdf, note);

    if (!json || !Array.isArray(json.lines)) {
      note = "Your previous answer was not valid JSON with a `lines` array. Return only the JSON object.";
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
        message: `Statement read on attempt ${attempt}: ${lines.length} lines, ties out`,
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
      `You returned ${lines.length} rows totalling ${totals.debits} in debits, ${totals.credits} in credits and ${totals.payments} in payments.`,
      `opening ${json.openingBalance} + debits − credits − payments = ${control.expected}, but the statement prints a closing balance of ${json.closingBalance}.`,
      `That is a gap of ${control.diff}.`,
      "Almost always this means a row was missed, a row was duplicated, or a Cr marker was read as a debit. Re-read the statement page by page and return the complete list.",
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
