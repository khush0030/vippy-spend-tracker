import sharp from "sharp";
// Relative, not aliased: this module is exercised directly by `node --test`,
// which does not know about the bundler's "@/" prefix.
import { validateQuad, outputSize, homography, projectPoint } from "./receipt-geometry.js";

/**
 * Making a photograph look like a scan.
 *
 * Accounts receives paper, or the nearest thing to it: deskewed, cropped to the
 * bill, grey on white. The original bytes are never touched — they are the
 * evidence, and a crop that went wrong must always be recoverable.
 *
 * Deliberately not one-bit black and white. It photographs beautifully on a
 * crisp printed invoice and destroys a thermal till roll that has spent a day
 * in a pocket, which is most of what this card produces. High-contrast grey
 * reads the same across the table and loses nothing.
 */

/** Long edge of the finished scan. Enough to read, small enough to email. */
const MAX_EDGE = 2000;

/**
 * How far outside the reported corners to cut.
 *
 * A model asked for the corners of a bill puts them on the paper rather than
 * just outside it, and varies by a percent or two between reads. Rather than
 * trusting that precision, the warp deliberately takes a generous bite of the
 * surroundings and a deterministic pass afterwards finds the real paper edge.
 * The model only has to be approximately right, which it reliably is.
 */
const CORNER_PADDING = 0.15;

/** A row or column is inspected against this to tell paper from table. */
const PAPER_LEVEL = 165;

/** Share of a line that must be bright before it counts as paper. */
const PAPER_TOLERANCE = 0.5;

function padCorners(corners, padding) {
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  return corners.map((p) => ({
    x: clamp01(p.x + (p.x - cx) * padding),
    y: clamp01(p.y + (p.y - cy) * padding),
  }));
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Shave the background the safe crop left behind.
 *
 * Widening the quad until no paper touched the border is what makes the crop
 * safe, and it necessarily leaves a rim of table around the bill. This walks in
 * from each side while the line is still mostly background and stops the moment
 * paper appears, so it can only ever remove what was never part of the receipt.
 */
function paperBounds({ data, width, height, channels }) {
  const luma = (x, y) => {
    const i = (y * width + x) * channels;
    if (channels < 3) return data[i];
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  const rowIsPaper = (y) => {
    let paper = 0;
    for (let x = 0; x < width; x++) if (luma(x, y) > PAPER_LEVEL) paper++;
    return paper / width > PAPER_TOLERANCE;
  };
  const colIsPaper = (x) => {
    let paper = 0;
    for (let y = 0; y < height; y++) if (luma(x, y) > PAPER_LEVEL) paper++;
    return paper / height > PAPER_TOLERANCE;
  };

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;

  while (top < bottom && !rowIsPaper(top)) top++;
  while (bottom > top && !rowIsPaper(bottom)) bottom--;
  while (left < right && !colIsPaper(left)) left++;
  while (right > left && !colIsPaper(right)) right--;

  // A thin margin of table reads as a scan edge and guards the outermost print.
  const margin = Math.round(Math.min(width, height) * 0.008);
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);

  const w = right - left + 1;
  const h = bottom - top + 1;

  // Anything this severe means the brightness test misread the picture.
  if (w < width * 0.35 || h < height * 0.35) return null;
  return { left, top, width: w, height: h };
}

/**
 * Backwards-sample the source through the homography.
 *
 * Nearest-neighbour on a downscaled source rather than bilinear: the sharpen
 * and contrast pass that follows hides the difference, and this runs per pixel
 * in a serverless function where an extra 3 multiplications per channel is not
 * free.
 */
function warp({ data, width, height, channels }, corners, out) {
  const srcPx = corners.map((p) => ({ x: p.x * width, y: p.y * height }));
  const h = homography(srcPx, out.width, out.height);
  if (!h) return null;

  const dest = Buffer.alloc(out.width * out.height * channels, 255);

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = projectPoint(h, x, y);
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;

      const from = (sy * width + sx) * channels;
      const to = (y * out.width + x) * channels;
      for (let c = 0; c < channels; c++) dest[to + c] = data[from + c];
    }
  }

  return dest;
}

/**
 * `{ buffer, mime, cropped, reason, width, height }`.
 *
 * `corners` is optional and comes from the vision models as four points in
 * 0..1. A quad that does not survive validation is ignored and the whole frame
 * is cleaned instead — the enhancement is worth having even when the crop is
 * not trustworthy.
 */
export async function makeScan(input, { corners = null, maxEdge = MAX_EDGE } = {}) {
  // EXIF rotation first: everything downstream is in display orientation, and
  // phone photos are routinely stored sideways.
  const upright = await sharp(input).rotate().toBuffer();

  let pipeline = sharp(upright);
  let cropped = false;
  let reason = corners ? null : "no corners offered";

  if (corners) {
    const check = validateQuad(corners);
    if (!check.ok) {
      reason = check.reason;
    } else {
      const raw = await sharp(upright).raw().toBuffer({ resolveWithObject: true });
      const src = {
        data: raw.data,
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      };

      const padded = padCorners(check.corners, CORNER_PADDING);
      const out = outputSize(padded, src.width, src.height);
      const warped = warp(src, padded, out);

      if (!warped) {
        reason = "could not solve the perspective";
      } else {
        const box = paperBounds({
          data: warped,
          width: out.width,
          height: out.height,
          channels: src.channels,
        });

        pipeline = sharp(warped, {
          raw: { width: out.width, height: out.height, channels: src.channels },
        });

        // Without a confident paper edge the deskewed but roomy crop still
        // beats the original: straight, and no hand or table in the corner.
        if (box) pipeline = pipeline.extract(box);
        else reason = "kept a wide margin: could not find the paper edge";

        cropped = true;
      }

      if (!cropped) pipeline = sharp(upright);
    }
  }

  const buffer = await pipeline
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .greyscale()
    // Stretch to full range, then lift the midtones: paper goes white and the
    // print stays black without the clipping a hard threshold would cause.
    .normalise()
    .linear(1.15, -18)
    .sharpen({ sigma: 1 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const meta = await sharp(buffer).metadata();

  return {
    buffer,
    mime: "image/jpeg",
    cropped,
    reason,
    width: meta.width,
    height: meta.height,
  };
}

/** Where the cleaned copy lives, derived from the original's path. */
export function scanPathFor(storagePath) {
  return storagePath.replace(/\.[^./]+$/, "") + "-scan.jpg";
}

/** PDFs and anything that is not a photograph are passed through untouched. */
export function isScannable(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}
