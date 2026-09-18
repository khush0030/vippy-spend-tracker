// lib/chat-tools.js
import { getSupabaseAdmin } from "@/lib/supabase";
import { currentCycle, billingCycle, cycleCoverage, cycleScope } from "@/lib/cycles";
import { resolvePeriod } from "@/lib/chat-periods";
import { validateArgs, WRITE_TOOLS, CATEGORIES } from "@/lib/chat-args";
import { renameMerchant } from "@/lib/merchant-alias";
import { buildSubscriptions, upcoming30Days } from "@/lib/subscriptions";
import { findCandidates, linkReceipt } from "@/lib/match-service";
import { scoreCandidate } from "@/lib/matcher";
import { getCardAccount } from "@/lib/cycles";

/**
 * Everything the chat model can know or do, as named tools.
 *
 * The model never sees a query. It asks a question by name with a few
 * arguments, gets back compact JSON scoped to the user the handler passed
 * in, and states what it found. Writes come back as a proposal the handler
 * turns into a Confirm button; nothing changes until that button is pressed.
 */

const MAX_ROWS = 40;

export const TOOL_DEFS = [
  tool("spend_summary", "Total spend, count, refunds and per-category totals for a period — use this for 'any refunds' questions about a cycle/month, not statement_summary (that is the last closed statement only).", {
    period: periodParam(),
  }, ["period"]),
  tool("spend_by_merchant", "Spend grouped by merchant for a period, largest first, with the period's total.", {
    period: periodParam(), top: { type: "integer", description: "How many merchants, 1-40, default 10" },
  }, ["period"]),
  tool("search_transactions", "Find transactions by merchant/notes text, amount range, category, within a period. match_count and match_total (refunds excluded) cover every match, not just the rows shown.", {
    query: { type: "string", description: "Text to match in merchant or notes (optional)" },
    period: periodParam(), min_amount: { type: "number" }, max_amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES }, limit: { type: "integer", description: "1-40, default 20" },
  }, []),
  tool("missing_receipts", "Charges still without a receipt in a period (default billing_cycle — the cycle whose bill is being paid; use it unless the user names another period). Also returns receipts_waiting: receipts the user already sent that have not matched a charge (count and newest few; waiting_receipts lists all). count is the number of charges missing.", {
    period: periodParam(),
  }, []),
  tool("waiting_receipts", "Receipts the user sent (photo or PDF) that are saved but not matched to a charge yet — still being read, or waiting for the bank alert. Newest first. could_be is the closest charge (transaction id, score out of 100) when one is plausible; offer it with match_receipt.", {}, []),
  tool("receipt_status", "Whether one charge has a receipt, by transaction id or by merchant and amount.", {
    transaction_id: { type: "integer" }, merchant: { type: "string" }, amount: { type: "number" },
  }, []),
  tool("cycle_status", "The billing cycle (the one whose receipts are being chased and sent to accounts) and the open cycle: dates, receipt coverage, days to statement and to submission.", {}, []),
  tool("statement_summary", "The latest reconciled statement: totals, tie-out result, refunds.", {
    which: { type: "string", description: "'latest' (default)" },
  }, []),
  tool("subscriptions", "Recurring charges detected from history, with expected next dates.", {}, []),
  tool("compare_periods", "Totals and biggest movers between two periods.", {
    a: periodParam(), b: periodParam(),
  }, ["a", "b"]),
  tool("declare_no_bill", "Mark a charge as having no bill and return the confirmation prompt (asks for confirmation). Call this directly once you know the transaction_id — e.g. right after search_transactions finds it — rather than only describing the action in text.", {
    transaction_id: { type: "integer" },
  }, ["transaction_id"]),
  tool("mark_recurring", "Tag a merchant as recurring so pings say the invoice is usually emailed (asks for confirmation).", {
    merchant: { type: "string" },
  }, ["merchant"]),
  tool("rename_merchant", "Rename a merchant everywhere and remember it for future syncs (asks for confirmation).", {
    from: { type: "string" }, to: { type: "string" },
  }, ["from", "to"]),
  tool("set_category", "Change one transaction's category (asks for confirmation).", {
    transaction_id: { type: "integer" }, category: { type: "string", enum: CATEGORIES },
  }, ["transaction_id", "category"]),
  tool("match_receipt", "File a waiting receipt against a charge and return the confirmation prompt (asks for confirmation). Call this directly once the user names or agrees to the charge — the Confirm button is how they approve, so do not ask in text instead. receipt_ref and transaction_ids come from waiting_receipts (could_be) or search_transactions; pass several transaction_ids only if one bill covers several charges.", {
    receipt_ref: { type: "string", description: "8-character receipt_ref from waiting_receipts" }, transaction_ids: { type: "array", items: { type: "integer" } },
  }, ["receipt_ref", "transaction_ids"]),
  tool("snooze_pings", "Pause receipt pings until a date (asks for confirmation).", {
    until_date: { type: "string", description: "YYYY-MM-DD" },
  }, ["until_date"]),
];

function tool(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}
function periodParam() {
  return {
    type: "string",
    description: "billing_cycle | this_cycle | last_cycle | this_month | last_month | YYYY-MM | a month name | last_N_days | today | yesterday | YYYY-MM-DD (one day) | YYYY-MM-DD..YYYY-MM-DD",
  };
}

async function txnsIn(sb, userId, { start, end }, extra = (q) => q) {
  const { data } = await extra(
    sb.from("transactions")
      .select("id, merchant, amount, date, category, is_refund, receipt_status, notes")
      .eq("user_id", userId)
      .gte("date", start)
      .lte("date", end)
  ).order("date", { ascending: false }).limit(2000);
  return data || [];
}

// "pending" is not read yet; "unmatched" is read with no charge to bind to.
async function waitingReceipts(sb, userId) {
  const { data, error } = await sb.from("receipts")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "unmatched"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    receipt_ref: r.id.slice(0, 8), full: r,
    merchant: r.merchant || "(not read yet)", amount: r.amount, currency: r.currency, receipt_date: r.receipt_date,
    state: r.status === "pending" ? "not read yet" : "no matching charge yet", sent_on: r.created_at.slice(0, 10),
  }));
}

const spent = (rows) => rows.filter((t) => !t.is_refund);
const sum = (rows) => Math.round(rows.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;
const trim = (rows) => (rows.length > MAX_ROWS ? { rows: rows.slice(0, MAX_ROWS), truncated: rows.length - MAX_ROWS } : { rows });

const READ = {
  async spend_summary({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const all = await txnsIn(sb, userId, p);
    const rows = spent(all);
    const by = {};
    for (const t of rows) by[t.category || "other"] = (by[t.category || "other"] || 0) + Number(t.amount);
    const refunds = sum(all.filter((t) => t.is_refund));
    for (const k of Object.keys(by)) by[k] = Math.round(by[k] * 100) / 100;
    return { period: p, total: sum(rows), count: rows.length, refunds, by_category: by };
  },
  async spend_by_merchant({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const rows = spent(await txnsIn(sb, userId, p));
    const by = {};
    for (const t of rows) { const k = t.merchant; by[k] = by[k] || { merchant: k, total: 0, count: 0 }; by[k].total += Number(t.amount); by[k].count++; }
    const list = Object.values(by).sort((a, b) => b.total - a.total).slice(0, args.top).map((m) => ({ ...m, total: Math.round(m.total * 100) / 100 }));
    return { period: p, period_total: sum(rows), merchants: list };
  },
  async search_transactions({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const rows = await txnsIn(sb, userId, p, (q) => {
      if (args.query) {
        // PostgREST reads , ( ) . " : as filter syntax inside or(), and % _ * are
        // ilike/PostgREST wildcards; a plain wildcard keeps the match loose instead.
        const needle = args.query.replace(/[,().%_":*]/g, "%");
        q = q.or(`merchant.ilike.%${needle}%,notes.ilike.%${needle}%`);
      }
      if (args.min_amount != null) q = q.gte("amount", args.min_amount);
      if (args.max_amount != null) q = q.lte("amount", args.max_amount);
      if (args.category) q = q.eq("category", args.category);
      return q;
    });
    const shown = rows.slice(0, args.limit);
    return { period: p, match_count: rows.length, match_total: sum(spent(rows)), ...trim(shown) };
  },
  async missing_receipts({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    // The billing cycle is its statement's lines once that is reconciled, not a date range.
    const billed = args.period === "billing_cycle" && ctx.billing ? await cycleScope(ctx.billing) : null;
    const all = billed
      ? (await billed(sb.from("transactions").select("id, merchant, amount, date, is_refund, receipt_status").eq("user_id", userId)).order("date", { ascending: false })).data || []
      : await txnsIn(sb, userId, p);
    const rows = all.filter((t) => !t.is_refund && t.receipt_status === "missing");
    const waiting = await waitingReceipts(sb, userId);
    return {
      // First, so a reply built from this result mentions receipts already sent.
      receipts_waiting: { count: waiting.length, newest: waiting.slice(0, 5).map(({ full, ...r }) => r) },
      period: p, count: rows.length, total_missing: sum(rows),
      ...trim(rows.map(({ id, merchant, amount, date }) => ({ id, merchant, amount, date }))),
    };
  },
  async waiting_receipts({ sb, userId }) {
    const rows = await waitingReceipts(sb, userId);
    const card = await getCardAccount(userId).catch(() => null);
    const shown = rows.slice(0, MAX_ROWS);
    await Promise.all(shown.map(async (r) => {
      const best = (await findCandidates(userId, r.full, card))
        .map((txn) => ({ txn, ...scoreCandidate(r.full, txn, { cardLast4: card?.last4 }) }))
        .filter((c) => !c.disqualified && c.score >= 45)
        .sort((a, b) => b.score - a.score)[0];
      if (best) r.could_be = { transaction_id: best.txn.id, merchant: best.txn.merchant, amount: best.txn.amount, date: best.txn.date, score: best.score,
        ...(best.foreign ? { amount_note: `the INR charge is this ${r.currency} bill converted, plus the card's forex markup — the amounts agree` } : {}) };
    }));
    return { count: rows.length, ...trim(rows.map(({ full, ...r }) => r)) };
  },
  async receipt_status({ sb, userId, args }) {
    let q = sb.from("transactions").select("id, merchant, amount, date, receipt_status, declared_reason").eq("user_id", userId);
    if (args.transaction_id) q = q.eq("id", args.transaction_id);
    else {
      if (!args.merchant && args.amount == null) return { error: "give a transaction_id, or a merchant and/or amount" };
      if (args.merchant) q = q.ilike("merchant", `%${args.merchant}%`);
      if (args.amount != null) q = q.eq("amount", args.amount);
    }
    const { data } = await q.order("date", { ascending: false }).limit(10);
    return { matches: data || [] };
  },
  async cycle_status({ userId, ctx }) {
    const cycle = ctx.billing;
    if (!cycle) return { error: "no card configured" };
    const cov = await cycleCoverage(userId, cycle);
    const days = (iso) => Math.ceil((new Date(`${iso}T00:00:00Z`) - new Date(`${ctx.today}T00:00:00Z`)) / 86400e3);
    return {
      cycle_start: cycle.cycle_start, cycle_end: cycle.cycle_end, status: cycle.status,
      days_to_statement: days(cycle.cycle_end), submit_day: cycle.card?.submit_day ?? null,
      coverage: cov,
      open_cycle: ctx.cycle && ctx.cycle.id !== cycle.id ? { cycle_start: ctx.cycle.cycle_start, cycle_end: ctx.cycle.cycle_end } : null,
    };
  },
  async statement_summary({ sb, userId }) {
    const { data: st } = await sb.from("statements")
      .select("id, issued_on, status, period_start, period_end, opening_balance, closing_balance, total_debits, total_credits, tie_out_diff")
      .eq("user_id", userId).order("issued_on", { ascending: false }).limit(1).maybeSingle();
    if (!st) return { error: "no statement on file yet" };
    const { data: lines } = await sb.from("statement_lines").select("direction, amount").eq("statement_id", st.id);
    const credits = (lines || []).filter((l) => l.direction === "credit");
    return { ...st, line_count: (lines || []).length, credit_lines: credits.length, credit_total: sum(credits) };
  },
  async subscriptions({ sb, userId, ctx }) {
    const { data } = await sb.from("transactions").select("merchant, amount, date, category, is_refund").eq("user_id", userId).order("date", { ascending: false }).limit(3000);
    const subs = buildSubscriptions((data || []).map((t) => ({ ...t, isRefund: t.is_refund })));
    return { subscriptions: subs.slice(0, MAX_ROWS), upcoming_30_days: upcoming30Days(subs, new Date(`${ctx.today}T00:00:00Z`)) };
  },
  async compare_periods({ sb, userId, ctx, args }) {
    const [A, B] = await Promise.all([
      READ.spend_by_merchant({ sb, userId, ctx, args: { period: args.a, top: 40 } }),
      READ.spend_by_merchant({ sb, userId, ctx, args: { period: args.b, top: 40 } }),
    ]);
    // The whole period's total, not the sum of the top-40 merchants shown.
    const totals = { a: A.period_total, b: B.period_total };
    const byName = {};
    for (const m of A.merchants) byName[m.merchant] = { merchant: m.merchant, a: m.total, b: 0 };
    for (const m of B.merchants) (byName[m.merchant] ||= { merchant: m.merchant, a: 0, b: 0 }).b = m.total;
    const movers = Object.values(byName).map((x) => ({ ...x, delta: Math.round((x.b - x.a) * 100) / 100 }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 10);
    return { a: A.period, b: B.period, totals, delta: Math.round((totals.b - totals.a) * 100) / 100, movers };
  },
};

const PROPOSE = {
  async declare_no_bill({ sb, userId, args }) {
    const { data: t } = await sb.from("transactions").select("id, merchant, amount, date, receipt_status").eq("id", args.transaction_id).eq("user_id", userId).maybeSingle();
    if (!t) return { error: `no transaction ${args.transaction_id}` };
    // Only a charge still waiting on a receipt can be declared billless.
    if (t.receipt_status !== "missing") return { error: `that charge already has status ${t.receipt_status}` };
    return { confirm: { kind: "declare_no_bill", summary: `Mark ₹${t.amount} ${t.merchant} (${t.date}) as having no bill`, payload: { transaction_id: t.id } } };
  },
  async mark_recurring({ args }) {
    return { confirm: { kind: "mark_recurring", summary: `Tag "${args.merchant}" as recurring (pings will say the invoice is usually emailed; receipts are still required)`, payload: { merchant: args.merchant } } };
  },
  async rename_merchant({ sb, userId, args }) {
    const { count } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("merchant", args.from);
    if (!count) return { error: `no transactions named exactly "${args.from}"` };
    return { confirm: { kind: "rename_merchant", summary: `Rename "${args.from}" → "${args.to}" on ${count} transaction(s) and remember it`, payload: { from: args.from, to: args.to } } };
  },
  async set_category({ sb, userId, args }) {
    const { data: t } = await sb.from("transactions").select("id, merchant, amount, category").eq("id", args.transaction_id).eq("user_id", userId).maybeSingle();
    if (!t) return { error: `no transaction ${args.transaction_id}` };
    return { confirm: { kind: "set_category", summary: `Change ₹${t.amount} ${t.merchant} from ${t.category} to ${args.category}`, payload: { transaction_id: t.id, category: args.category } } };
  },
  async match_receipt({ sb, userId, args }) {
    const { data: open } = await sb.from("receipts").select("id, merchant, amount, currency, receipt_date").eq("user_id", userId).in("status", ["pending", "unmatched"]).limit(500);
    const r = (open || []).find((x) => x.id.startsWith(args.receipt_ref));
    if (!r) return { error: `no waiting receipt with receipt_ref ${args.receipt_ref} — check waiting_receipts` };
    const { data: txns } = await sb.from("transactions").select("id, merchant, amount, date").in("id", args.transaction_ids).eq("user_id", userId);
    if ((txns || []).length !== args.transaction_ids.length) return { error: "one of those transactions was not found" };
    const bill = `${r.merchant || "receipt"} ${r.currency || "INR"} ${r.amount} (${r.receipt_date})`;
    const charges = txns.map((t) => `#${t.id} ${t.merchant} ₹${t.amount} (${t.date})`).join(", ");
    return { confirm: { kind: "match_receipt", summary: `File ${bill} against ${charges}`, payload: { receipt_id: r.id, transaction_ids: args.transaction_ids } } };
  },
  async snooze_pings({ args }) {
    return { confirm: { kind: "snooze_pings", summary: `Pause receipt pings until ${args.until_date}`, payload: { until_date: args.until_date } } };
  },
};

export async function runTool({ userId, name, args, today = new Date().toISOString().slice(0, 10) }) {
  const v = validateArgs(name, args);
  if (!v.ok) return JSON.stringify({ error: v.error });
  const sb = getSupabaseAdmin();
  const [cycle, billing] = await Promise.all([currentCycle(userId).catch(() => null), billingCycle(userId).catch(() => null)]);
  const ctx = { today, cycle, billing: billing || cycle };
  try {
    const fn = WRITE_TOOLS.has(name) ? PROPOSE[name] : READ[name];
    return JSON.stringify(await fn({ sb, userId, ctx, args: v.args }));
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// Every write checks Supabase's error and, where it targets rows, that one
// actually changed — otherwise a failed write would still show ✅.
async function changed(query, missing) {
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(missing);
}

export async function executeWrite({ userId, kind, payload }) {
  const sb = getSupabaseAdmin();
  switch (kind) {
    case "declare_no_bill":
      await changed(
        sb.from("transactions").update({ receipt_status: "declared", declared_reason: "no bill exists" }).eq("id", payload.transaction_id).eq("user_id", userId).eq("receipt_status", "missing"),
        "that charge is no longer missing a receipt"
      );
      return "Marked as no bill.";
    case "mark_recurring": {
      const { error } = await sb.from("recurring_merchants").upsert({ user_id: userId, merchant: payload.merchant }, { onConflict: "user_id,merchant" });
      if (error) throw new Error(error.message);
      return `"${payload.merchant}" tagged as recurring.`;
    }
    case "rename_merchant": {
      const r = await renameMerchant({ supabase: sb, userId, from: payload.from, to: payload.to });
      return `Renamed on ${r.updated} transaction(s).`;
    }
    case "set_category":
      await changed(
        sb.from("transactions").update({ category: payload.category }).eq("id", payload.transaction_id).eq("user_id", userId),
        "that transaction was not found"
      );
      return `Category set to ${payload.category}.`;
    case "snooze_pings":
      // Every card the user has — maybeSingle() would fail outright with two.
      await changed(
        sb.from("card_accounts").update({ pings_paused_until: payload.until_date }).eq("user_id", userId),
        "no card configured"
      );
      return `Pings paused until ${payload.until_date}.`;
    case "match_receipt": {
      for (const transactionId of payload.transaction_ids) {
        await linkReceipt({ receiptId: payload.receipt_id, transactionId, userId, score: null, matchedBy: "user" });
      }
      // linkReceipt logs rather than throws; the receipt's status says whether it took.
      const { data } = await sb.from("receipts").select("status").eq("id", payload.receipt_id).eq("user_id", userId).maybeSingle();
      if (data?.status === "duplicate") return "That charge already has its bill — kept this copy aside as a duplicate.";
      if (data?.status !== "matched") throw new Error("the receipt could not be filed");
      return "Receipt filed.";
    }
    case "batch": {
      // Each item stands alone: one that fails must not undo or block the rest,
      // and the reply says exactly which did not apply.
      const failed = [];
      for (const item of payload.items) {
        try {
          await executeWrite({ userId, kind: item.kind, payload: item.payload });
        } catch (err) {
          failed.push(`${item.summary} — ${err.message}`);
        }
      }
      if (failed.length === payload.items.length) throw new Error(failed.join("; "));
      const done = payload.items.length - failed.length;
      return failed.length ? `${done} of ${payload.items.length} applied. Not applied:\n${failed.join("\n")}` : `All ${done} applied.`;
    }
    default:
      throw new Error(`unknown write ${kind}`);
  }
}
