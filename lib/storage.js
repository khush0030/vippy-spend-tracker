import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Object storage behind a three-method interface: put / signedUrl / remove.
 *
 * Deliberately thin. Receipt images are private and must never be served from
 * a public URL — callers get a short-lived signed URL or nothing. Keeping the
 * surface this small means swapping Supabase Storage for R2 or Vercel Blob
 * later is one file, not a migration.
 */

export const RECEIPTS_BUCKET = "receipts";
const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * receipts/{user_id}/{YYYY}/{MM}/{uuid}.{ext}
 * Date-partitioned so a cycle's objects are contiguous and cheap to list.
 */
export function receiptPath({ userId, date, id, ext }) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${userId}/${yyyy}/${mm}/${id}.${safeExt}`;
}

export async function put(path, body, { contentType, bucket = RECEIPTS_BUCKET } = {}) {
  const { error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .upload(path, body, { contentType, upsert: false });

  if (error) throw new Error(`storage put failed (${path}): ${error.message}`);
  return { path, bucket };
}

export async function signedUrl(
  path,
  { expiresIn = SIGNED_URL_TTL_SECONDS, bucket = RECEIPTS_BUCKET, download } = {}
) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expiresIn, download ? { download } : undefined);

  if (error) throw new Error(`storage signedUrl failed (${path}): ${error.message}`);
  return data.signedUrl;
}

export async function get(path, { bucket = RECEIPTS_BUCKET } = {}) {
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(path);
  if (error) throw new Error(`storage get failed (${path}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function remove(paths, { bucket = RECEIPTS_BUCKET } = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  const { error } = await getSupabaseAdmin().storage.from(bucket).remove(list);
  if (error) throw new Error(`storage remove failed: ${error.message}`);
}

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

export function extForMime(mime) {
  return MIME_EXT[String(mime || "").toLowerCase()] || "bin";
}
