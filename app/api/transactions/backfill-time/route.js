import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { fetchHDFCEmails } from "@/lib/gmail";

// Regex patterns to extract time from email body
const TIME_PATTERNS = [
  /\bat\s+(\d{1,2}:\d{2})(?::\d{2})?\s*(?:hrs?|IST|GMT|UTC)?/i,
  /\btime[:\s]+(\d{1,2}:\d{2})(?::\d{2})?\s*(?:hrs?|IST|AM|PM)?/i,
  /(\d{1,2}:\d{2})(?::\d{2})?\s*(?:IST|hrs)/i,
  /(\d{1,2}:\d{2})\s*(AM|PM)/i,
];

function extractTime(emailBody, emailDateHeader) {
  for (const pat of TIME_PATTERNS) {
    const m = emailBody?.match(pat);
    if (m) {
      let [h, min] = m[1].split(":").map(Number);
      if (m[2] && /PM/i.test(m[2]) && h < 12) h += 12;
      if (m[2] && /AM/i.test(m[2]) && h === 12) h = 0;
      if (h >= 0 && h < 24 && min >= 0 && min < 60) {
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }
    }
  }
  if (emailDateHeader) {
    try {
      const dt = new Date(emailDateHeader);
      if (!isNaN(dt.getTime())) {
        const ist = new Date(dt.getTime() + (5.5 * 60 * 60 * 1000 - dt.getTimezoneOffset() * 60 * 1000));
        const h = ist.getUTCHours(), min = ist.getUTCMinutes();
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }
    } catch {}
  }
  return null;
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  // Get transactions missing txn_time
  const { data: missing, error: fetchErr } = await supabase
    .from("transactions")
    .select("id, email_id, date")
    .eq("user_id", session.user.id)
    .is("txn_time", null);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!missing || missing.length === 0) {
    return NextResponse.json({ updated: 0, message: "All transactions already have timestamps." });
  }

  // Fetch all emails to match against
  const emails = await fetchHDFCEmails(null);
  const emailMap = new Map(emails.map(e => [e.id, e]));

  let updated = 0;
  for (const txn of missing) {
    const email = emailMap.get(txn.email_id);
    if (!email) continue;

    const time = extractTime(email.body, email.date);
    if (!time) continue;

    const { error: upErr } = await supabase
      .from("transactions")
      .update({ txn_time: time })
      .eq("id", txn.id)
      .eq("user_id", session.user.id);

    if (!upErr) updated++;
  }

  return NextResponse.json({
    updated,
    total: missing.length,
    message: `Updated ${updated} of ${missing.length} transactions with timestamps.`,
  });
}
