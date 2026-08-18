import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { put, receiptPath, extForMime } from "@/lib/storage";
import { downloadFile } from "@/lib/telegram";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * Receipt intake: bytes in, durable private object + `receipts` row out.
 *
 * Extraction and matching deliberately live elsewhere — this stage only has to
 * be fast, idempotent, and never lose a file.
 */

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Store one incoming file.
 *
 * Re-sending the same photo returns the original row rather than creating a
 * second one — the cheapest possible defence against duplicate submissions,
 * and it makes "you already sent me this" instant and free (no vision call).
 */
export async function intakeReceipt({
  userId,
  buffer,
  mime,
  originalName = null,
  source = "telegram",
  tgChatId = null,
  tgMessageId = null,
  tgFileId = null,
}) {
  const sb = getSupabaseAdmin();
  const digest = sha256(buffer);

  const { data: existing } = await sb
    .from("receipts")
    .select("*")
    .eq("user_id", userId)
    .eq("sha256", digest)
    .maybeSingle();

  if (existing) {
    await logInfo({
      source: "receipt",
      event: "duplicate",
      userId,
      message: `Duplicate receipt re-sent (${digest.slice(0, 12)})`,
      details: { receiptId: existing.id },
    });
    return { receipt: existing, duplicate: true };
  }

  const id = crypto.randomUUID();
  const path = receiptPath({ userId, date: new Date(), id, ext: extForMime(mime) });

  await put(path, buffer, { contentType: mime });

  const { data, error } = await sb
    .from("receipts")
    .insert({
      id,
      user_id: userId,
      source,
      tg_chat_id: tgChatId,
      tg_message_id: tgMessageId,
      tg_file_id: tgFileId,
      storage_path: path,
      mime,
      bytes: buffer.length,
      sha256: digest,
      original_name: originalName,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`receipt insert failed: ${error.message}`);

  await logInfo({
    source: "receipt",
    event: "stored",
    userId,
    message: `Receipt stored (${(buffer.length / 1024).toFixed(0)} KB)`,
    details: { receiptId: id, mime },
  });

  return { receipt: data, duplicate: false };
}

/** Pull a Telegram attachment and hand it to intake. */
export async function intakeFromTelegram({ userId, attachment, chatId, messageId }) {
  const { buffer, mime } = await downloadFile(attachment.fileId);

  const effectiveMime = attachment.mime || mime;
  if (!/^image\/|^application\/pdf$/.test(effectiveMime || "")) {
    await logWarn({
      source: "receipt",
      event: "unsupported_type",
      userId,
      message: `Rejected ${effectiveMime}`,
    });
    throw new Error(
      "That file type isn't a receipt I can read. Send a photo, or a PDF invoice."
    );
  }

  return intakeReceipt({
    userId,
    buffer,
    mime: effectiveMime,
    originalName: attachment.name,
    tgChatId: chatId,
    tgMessageId: messageId,
    tgFileId: attachment.fileId,
  });
}
