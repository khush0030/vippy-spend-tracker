import { getSupabase } from "@/lib/supabase";

/**
 * Persist app errors + sync events to Supabase so failures leave a trail
 * beyond ephemeral Vercel stdout. Safe to call from anywhere — swallows
 * its own errors so logging never breaks the calling code path.
 *
 * Schema (run in Supabase SQL editor):
 *   create table if not exists app_logs (
 *     id bigserial primary key,
 *     created_at timestamptz not null default now(),
 *     level text not null check (level in ('info','warn','error')),
 *     source text not null,
 *     event text not null,
 *     user_id uuid,
 *     message text,
 *     details jsonb
 *   );
 *   create index if not exists app_logs_created_at_idx on app_logs (created_at desc);
 *   create index if not exists app_logs_level_idx on app_logs (level);
 *   create index if not exists app_logs_user_id_idx on app_logs (user_id);
 */

function extractError(err) {
  if (!err) return { message: "Unknown error" };
  if (typeof err === "string") return { message: err };
  return {
    message: err.message || String(err),
    name: err.name,
    code: err.code || err.status,
    stack: err.stack ? err.stack.split("\n").slice(0, 8).join("\n") : undefined,
    googleError: err?.response?.data || undefined,
  };
}

export async function logEvent({ level = "info", source, event, userId = null, message = null, details = null, error = null }) {
  try {
    const supabase = getSupabase();
    const payload = {
      level,
      source,
      event,
      user_id: userId,
      message: message || (error ? extractError(error).message : null),
      details: error ? { ...(details || {}), error: extractError(error) } : details,
    };

    const { error: insertErr } = await supabase.from("app_logs").insert(payload);

    if (insertErr) {
      console.error(`[logger] failed to persist: ${insertErr.message}`);
    }

    if (level === "error") {
      console.error(`[${source}] ${event}: ${payload.message}`, payload.details || "");
    } else if (level === "warn") {
      console.warn(`[${source}] ${event}: ${payload.message}`);
    } else {
      console.log(`[${source}] ${event}: ${payload.message || ""}`);
    }
  } catch (e) {
    console.error("[logger] unexpected failure:", e?.message);
  }
}

export const logInfo = (args) => logEvent({ ...args, level: "info" });
export const logWarn = (args) => logEvent({ ...args, level: "warn" });
export const logError = (args) => logEvent({ ...args, level: "error" });
