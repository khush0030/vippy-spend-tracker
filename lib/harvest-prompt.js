/**
 * What the model is asked, and how its answer is read. Pure — no imports, so
 * the prompt and the parser can be tested without an API key.
 *
 * The parser is deliberately forgiving of a model that wraps its JSON in a
 * fence or a sentence, and deliberately unforgiving of malformed entries: a
 * proposal missing a line number is dropped on its own rather than taking the
 * whole response with it.
 */

const MAX_LINES = 60;
const MAX_EMAILS = 120;

export function buildPrompt(lines, emails) {
  const lineRows = lines.slice(0, MAX_LINES).map((l) => {
    const target = l.currency && l.currency !== "INR" && l.amount_orig != null
      ? `${l.currency} ${l.amount_orig}`
      : `INR ${l.amount}`;
    return `  line ${l.line_no} | ${l.txn_date} | ${l.descriptor} | needs ${target}`;
  });

  const emailRows = emails.slice(0, MAX_EMAILS).map((e) => {
    const amounts = e.amounts.map((a) => `${a.currency} ${a.value}`).join(", ") || "none found";
    return `  ${e.messageId} | ${e.date} | ${e.from} | ${e.subject}\n      amounts: ${amounts}\n      excerpt: ${e.excerpt || ""}`;
  });

  return `These are credit card statement lines with no receipt, and emails that could not be matched to one by exact amount.

A line is usually explained by one email. Sometimes several emails together explain one line — three separate Amazon orders billed as one Amazon Pay charge, or a food delivery invoice plus its handling fee.

STATEMENT LINES:
${lineRows.join("\n")}

UNMATCHED EMAILS:
${emailRows.join("\n")}

Assign emails to lines only where you are confident. It is far better to leave a line unexplained than to guess.

Rules:
- The amounts you assign must sum to exactly what the line needs.
- Every amount must be in the same currency the line needs.
- An email may be used for at most one line.
- Do not invent messageIds or amounts. Use only what appears above.

Reply with JSON and nothing else:
{"proposals":[{"lineNo":7,"parts":[{"messageId":"e1","value":555,"currency":"INR"}]}]}

If nothing can be matched confidently, reply {"proposals":[]}.`;
}

export function parseProposals(raw) {
  if (!raw) return [];
  const text = String(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  return list.filter(
    (p) => Number.isInteger(p?.lineNo) && Array.isArray(p?.parts)
  ).map((p) => ({
    lineNo: p.lineNo,
    parts: p.parts
      .filter((x) => x && typeof x.messageId === "string" && Number.isFinite(Number(x.value)))
      .map((x) => ({ messageId: x.messageId, value: Number(x.value), currency: String(x.currency || "") })),
  }));
}
