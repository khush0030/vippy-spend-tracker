import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeScan, scanPathFor, isScannable } from "../lib/receipt-scan.js";

/**
 * A synthetic photograph: pale bill on a dark surface, tilted, with print that
 * runs close to its edges. Everything here is deterministic, so the guarantee
 * being tested — that a crop never eats the print — is checked without a model
 * and without a network.
 */
const FRAME = { width: 900, height: 1400 };
const PAPER = { left: 180, top: 150, width: 520, height: 1050 };
const TILT = -7;

/** Where the tilted paper's corners land, in 0..1. */
function trueCorners() {
  const rad = (TILT * Math.PI) / 180;
  const cx = PAPER.left + PAPER.width / 2;
  const cy = PAPER.top + PAPER.height / 2;
  const half = { x: PAPER.width / 2, y: PAPER.height / 2 };

  return [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ].map((p) => ({
    x: (cx + p.x * Math.cos(rad) - p.y * Math.sin(rad)) / FRAME.width,
    y: (cy + p.x * Math.sin(rad) + p.y * Math.cos(rad)) / FRAME.height,
  }));
}

async function photograph() {
  const lines = [];
  // Print running to within 6% of the paper edge, as a till roll does.
  const margin = PAPER.width * 0.06;
  for (let i = 0; i < 18; i++) {
    const y = 60 + i * 55;
    lines.push(
      `<rect x="${margin}" y="${y}" width="${PAPER.width - margin * 2}" height="18" fill="#111"/>`
    );
  }

  const paper = await sharp(
    Buffer.from(
      `<svg width="${PAPER.width}" height="${PAPER.height}">
         <rect width="100%" height="100%" fill="#f2f0ec"/>
         ${lines.join("")}
       </svg>`
    )
  )
    .rotate(TILT, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const rotated = await sharp(paper).metadata();

  return sharp({
    create: {
      width: FRAME.width,
      height: FRAME.height,
      channels: 3,
      background: { r: 24, g: 26, b: 30 },
    },
  })
    .composite([
      {
        input: paper,
        left: Math.round(PAPER.left + PAPER.width / 2 - rotated.width / 2),
        top: Math.round(PAPER.top + PAPER.height / 2 - rotated.height / 2),
      },
    ])
    .jpeg()
    .toBuffer();
}

/**
 * Count the printed bars.
 *
 * A row of print contains ink *and* paper. A row of table is uniformly dark,
 * and a blank part of the bill is uniformly pale — so the band in between is
 * what identifies a line of print, whether or not the frame was cropped.
 */
async function inspect(jpeg) {
  const { data, info } = await sharp(jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const darkShare = (y) => {
    let n = 0;
    for (let x = 0; x < width; x++) if (data[y * width + x] < 90) n++;
    return n / width;
  };

  // A printed line is several pixels tall; a one-pixel band is a sliver of
  // table left at the border by the crop, not print.
  const MIN_BAR = 4;

  let bars = 0;
  let run = 0;
  let widestBar = 0;

  for (let y = 0; y <= height; y++) {
    const share = y < height ? darkShare(y) : 0;
    const isPrint = share > 0.25 && share < 0.95;

    if (isPrint) {
      run++;
      widestBar = Math.max(widestBar, share * width);
    } else {
      if (run >= MIN_BAR) bars++;
      run = 0;
    }
  }

  return { bars, widestBar, width, height };
}

describe("makeScan", () => {
  let photo;
  let corners;

  before(async () => {
    photo = await photograph();
    corners = trueCorners();
  });

  test("keeps every printed line when the corners are exact", async () => {
    const scan = await makeScan(photo, { corners });
    assert.equal(scan.cropped, true);
    const { bars } = await inspect(scan.buffer);
    assert.equal(bars, 18);
  });

  test("keeps every printed line when the corners are read a little tight", async () => {
    // The failure this whole design exists to prevent: a model that places the
    // corners just inside the paper.
    const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
    const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
    const tight = corners.map((p) => ({
      x: p.x - (p.x - cx) * 0.05,
      y: p.y - (p.y - cy) * 0.05,
    }));

    const scan = await makeScan(photo, { corners: tight });
    const { bars } = await inspect(scan.buffer);
    assert.equal(bars, 18);
  });

  test("output barely moves as the reading jitters", async () => {
    const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
    const cy = corners.reduce((s, p) => s + p.y, 0) / 4;

    const sizes = [];
    for (const jitter of [-0.03, 0, 0.03]) {
      const shifted = corners.map((p) => ({
        x: p.x + (p.x - cx) * jitter,
        y: p.y + (p.y - cy) * jitter,
      }));
      const scan = await makeScan(photo, { corners: shifted });
      const { bars } = await inspect(scan.buffer);
      assert.equal(bars, 18, `jitter ${jitter} lost a line`);
      sizes.push(scan.width);
    }

    const spread = (Math.max(...sizes) - Math.min(...sizes)) / Math.min(...sizes);
    assert.ok(spread < 0.2, `width moved ${(spread * 100).toFixed(1)}% across readings`);
  });

  test("deskews: the tilted bill comes back square", async () => {
    const scan = await makeScan(photo, { corners });
    const { widestBar, width } = await inspect(scan.buffer);
    // A bar spanning most of the width only happens once the tilt is undone.
    assert.ok(widestBar > width * 0.75, `widest bar ${widestBar} of ${width}`);
  });

  test("nonsense corners fall back to cleaning the whole frame", async () => {
    const scan = await makeScan(photo, { corners: [{ x: 0, y: 0 }, { x: 0.01, y: 0 }] });
    assert.equal(scan.cropped, false);
    assert.match(scan.reason, /four points/);
    // Uncropped means the whole photograph, table and all — so its proportions
    // are the frame's, not the bill's.
    const ratio = scan.width / scan.height;
    assert.ok(Math.abs(ratio - FRAME.width / FRAME.height) < 0.02, `ratio ${ratio}`);
  });

  test("with no corners at all it still cleans and returns an image", async () => {
    const scan = await makeScan(photo);
    assert.equal(scan.cropped, false);
    assert.equal(scan.mime, "image/jpeg");
    assert.ok(scan.width > 0 && scan.height > 0);
  });

  test("never enlarges a small photo", async () => {
    const small = await sharp(photo).resize({ width: 400 }).jpeg().toBuffer();
    const scan = await makeScan(small, { corners });
    assert.ok(scan.width <= 400);
  });
});

describe("scanPathFor", () => {
  test("sits beside the original", () => {
    assert.equal(scanPathFor("u1/2026/08/abc.jpg"), "u1/2026/08/abc-scan.jpg");
    assert.equal(scanPathFor("u1/2026/08/abc.heic"), "u1/2026/08/abc-scan.jpg");
  });

  test("copes with a path that has no extension", () => {
    assert.equal(scanPathFor("u1/2026/08/abc"), "u1/2026/08/abc-scan.jpg");
  });
});

describe("isScannable", () => {
  test("photographs yes, PDFs and nonsense no", () => {
    assert.equal(isScannable("image/jpeg"), true);
    assert.equal(isScannable("image/heic"), true);
    assert.equal(isScannable("application/pdf"), false);
    assert.equal(isScannable(null), false);
  });
});
