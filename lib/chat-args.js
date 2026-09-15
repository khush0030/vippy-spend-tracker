/**
 * What the model is allowed to ask a tool for. Nothing here touches data;
 * a bad argument becomes a tool error string the model can read and retry.
 */

export const CATEGORIES = ["amazon", "fuel", "dining", "swiggy", "utilities", "subscriptions", "office", "travel", "other"];

const id = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
};
const clamp = (v, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(40, Math.max(1, Math.trunc(n)));
};
const text = (v, name, { required = true, max = 80 } = {}) => {
  const s = String(v ?? "").trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} is too long (max ${max})`);
  return s;
};
const isoDate = (v, name) => {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) throw new Error(`${name} must be YYYY-MM-DD`);
  return s;
};
const category = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!CATEGORIES.includes(s)) throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
  return s;
};
const optNumber = (v, name) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};

const SCHEMAS = {
  spend_summary: (a) => ({ period: text(a.period, "period", { max: 40 }) }),
  spend_by_merchant: (a) => ({ period: text(a.period, "period", { max: 40 }), top: clamp(a.top, 10) }),
  search_transactions: (a) => ({
    query: text(a.query, "query", { required: false }),
    period: text(a.period, "period", { required: false, max: 40 }) || "this_cycle",
    min_amount: optNumber(a.min_amount, "min_amount"),
    max_amount: optNumber(a.max_amount, "max_amount"),
    category: a.category ? category(a.category) : null,
    limit: clamp(a.limit, 20),
  }),
  missing_receipts: (a) => ({ period: text(a.period, "period", { required: false, max: 40 }) || "this_cycle" }),
  receipt_status: (a) => ({
    transaction_id: a.transaction_id != null ? id(a.transaction_id, "transaction_id") : null,
    merchant: text(a.merchant, "merchant", { required: false }),
    amount: optNumber(a.amount, "amount"),
  }),
  cycle_status: () => ({}),
  statement_summary: (a) => ({ which: text(a.which, "which", { required: false, max: 20 }) || "latest" }),
  subscriptions: () => ({}),
  compare_periods: (a) => ({ a: text(a.a, "a", { max: 40 }), b: text(a.b, "b", { max: 40 }) }),
  declare_no_bill: (a) => ({ transaction_id: id(a.transaction_id, "transaction_id") }),
  mark_recurring: (a) => ({ merchant: text(a.merchant, "merchant") }),
  rename_merchant: (a) => ({ from: text(a.from, "from"), to: text(a.to, "to") }),
  set_category: (a) => ({ transaction_id: id(a.transaction_id, "transaction_id"), category: category(a.category) }),
  snooze_pings: (a) => ({ until_date: isoDate(a.until_date, "until_date") }),
};

export const TOOL_NAMES = Object.keys(SCHEMAS);
export const WRITE_TOOLS = new Set(["declare_no_bill", "mark_recurring", "rename_merchant", "set_category", "snooze_pings"]);

export function validateArgs(toolName, args) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { ok: false, error: `Unknown tool: ${toolName}` };
  try {
    return { ok: true, args: schema(args || {}) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
