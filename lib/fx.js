import { getSupabaseAdmin } from "@/lib/supabase";
import { logWarn } from "@/lib/logger";

/**
 * Historical FX via Frankfurter (ECB daily reference rates) — free, no API key.
 *
 * Rates are only ever used to *estimate* what a foreign charge should have
 * posted as, so the matcher can recognise it. The authoritative rupee figure
 * always comes from the bank statement, never from here.
 *
 * Cached per (date, currency) in `fx_rates` — ECB publishes once a day and
 * never revises, so a cached rate is correct forever.
 */

const API = "https://api.frankfurter.app";
const QUOTE = "INR";

function isoDate(d) {
  return (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
}

export async function getRate(currency, date) {
  const base = String(currency || "").toUpperCase();
  if (!base || base === QUOTE) return 1;

  const day = isoDate(date);
  const sb = getSupabaseAdmin();

  const { data: cached } = await sb
    .from("fx_rates")
    .select("rate")
    .eq("rate_date", day)
    .eq("base", base)
    .eq("quote", QUOTE)
    .maybeSingle();

  if (cached?.rate) return Number(cached.rate);

  try {
    const res = await fetch(`${API}/${day}?from=${base}&to=${QUOTE}`);
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const json = await res.json();
    const rate = json?.rates?.[QUOTE];
    if (!(Number(rate) > 0)) throw new Error("no rate in response");

    // ECB skips weekends and holidays; Frankfurter answers with the preceding
    // business day and reports which one in `date`. Cache under the date we
    // asked for so the same lookup doesn't miss again tomorrow.
    await sb.from("fx_rates").upsert(
      {
        rate_date: day,
        base,
        quote: QUOTE,
        rate,
        source: json.date === day ? "ecb" : `ecb:${json.date}`,
      },
      { onConflict: "rate_date,base,quote" }
    );

    return Number(rate);
  } catch (err) {
    await logWarn({
      source: "fx",
      event: "rate_lookup_failed",
      message: `Could not fetch ${base}→${QUOTE} for ${day}`,
      details: { error: err.message },
    });
    return null;
  }
}

/**
 * Convenience for the matcher: returns { rate, amountInr } or nulls.
 * A null rate means "don't guess" — the receipt defers rather than mismatching.
 */
export async function toInr(amount, currency, date) {
  const rate = await getRate(currency, date);
  if (rate == null) return { rate: null, amountInr: null };
  return { rate, amountInr: Number(amount) * rate };
}
