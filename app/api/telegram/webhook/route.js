import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { handleUpdate } from "@/lib/tg-handlers";
import { logWarn } from "@/lib/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The single entry point for every Telegram update.
 *
 * Telegram retries any non-200, so this handler does only the cheap work —
 * verify, dedupe, acknowledge — and hands the expensive work (download,
 * extraction, matching) to `after()`, which runs once the response is already
 * on the wire. Nothing downstream can turn into a retry storm.
 */
export async function POST(request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");

  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    await logWarn({
      source: "telegram",
      event: "bad_secret",
      message: "Rejected webhook call with missing or wrong secret token",
    });
    // 401, not 403: gives a prober nothing and stops Telegram retrying forever.
    return new Response("unauthorized", { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Idempotency: a replayed update_id must not re-run the handler.
  if (update?.update_id != null) {
    const { error } = await getSupabaseAdmin()
      .from("tg_updates")
      .insert({ update_id: update.update_id });

    if (error) {
      // Primary-key violation means we've already processed this one.
      if (error.code === "23505") return Response.json({ ok: true, deduped: true });
      await logWarn({
        source: "telegram",
        event: "dedupe_write_failed",
        message: "Could not record update_id; processing anyway",
        details: { error: error.message },
      });
    }
  }

  after(() => handleUpdate(update));

  return Response.json({ ok: true });
}
