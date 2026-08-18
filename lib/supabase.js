import { createClient } from "@supabase/supabase-js";

let _supabase = null;
let _admin = null;

export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return _supabase;
}

/**
 * Server-only client using the service-role key.
 *
 * Needed because the app authenticates with NextAuth (Google), not Supabase
 * Auth — so `auth.uid()` is never populated and RLS policies written against
 * it would deny everything. New tables are deny-all for anon; every server
 * path goes through here and scopes by user_id in the query itself.
 *
 * Never import this into a client component.
 */
export function getSupabaseAdmin() {
  if (!_admin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is not set — required for storage writes and cron jobs"
      );
    }
    _admin = createClient(process.env.SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}
