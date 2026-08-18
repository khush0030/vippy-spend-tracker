import { logError } from "@/lib/logger";

/**
 * Thin Telegram Bot API client.
 *
 * Kept behind a small surface (send / edit / answer / file) so a second
 * channel — WhatsApp, or an email-in adapter — can be added later by writing
 * one more module rather than touching the pipeline.
 */

const API = "https://api.telegram.org";

// Telegram's own cap for files a bot may download.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

async function call(method, payload) {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    const message = json.description || `telegram ${method} failed (${res.status})`;
    await logError({
      source: "telegram",
      event: "api_error",
      message,
      details: { method, code: json.error_code },
    });
    throw new Error(message);
  }
  return json.result;
}

export async function sendMessage(chatId, text, { keyboard, replyTo, silent } = {}) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_notification: Boolean(silent),
    ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/**
 * Edit a message in place. Used to turn "Reading…" into the result card so
 * each receipt occupies exactly one message and the chat stays readable.
 */
export async function editMessage(chatId, messageId, text, { keyboard } = {}) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** Clears the button spinner. Telegram shows one until this is called. */
export async function answerCallback(callbackQueryId, text) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export async function sendDocument(chatId, buffer, filename, { caption, mime } = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append(
    "document",
    new Blob([buffer], { type: mime || "application/octet-stream" }),
    filename
  );

  const res = await fetch(`${API}/bot${token()}/sendDocument`, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.description || "telegram sendDocument failed");
  return json.result;
}

/** Resolve a file_id to bytes. Returns { buffer, mime, size, path }. */
export async function downloadFile(fileId) {
  const file = await call("getFile", { file_id: fileId });

  if (file.file_size && file.file_size > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${(file.file_size / 1024 / 1024).toFixed(1)} MB — Telegram bots cannot download over 20 MB. Send it as a photo rather than an uncompressed document.`
    );
  }

  const res = await fetch(`${API}/file/bot${token()}/${file.file_path}`);
  if (!res.ok) throw new Error(`telegram file download failed (${res.status})`);

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mime: guessMime(file.file_path),
    size: file.file_size ?? null,
    path: file.file_path,
  };
}

function guessMime(path) {
  const ext = String(path || "").split(".").pop()?.toLowerCase();
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      pdf: "application/pdf",
    }[ext] || "application/octet-stream"
  );
}

export async function setWebhook(url, secret) {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function getWebhookInfo() {
  return call("getWebhookInfo", {});
}

/**
 * Pull the largest available photo, or a document, off an incoming message.
 * Telegram sends photos as a ladder of sizes — the last is the biggest.
 */
export function extractAttachment(message) {
  if (Array.isArray(message?.photo) && message.photo.length) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, kind: "photo", name: null, mime: "image/jpeg" };
  }
  if (message?.document) {
    return {
      fileId: message.document.file_id,
      kind: "document",
      name: message.document.file_name || null,
      mime: message.document.mime_type || null,
    };
  }
  return null;
}

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
