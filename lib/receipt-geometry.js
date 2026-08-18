/**
 * Turning four corners into a flat rectangle.
 *
 * The models that read a receipt also report where its corners are, which is
 * cheaper and more robust than edge-detecting a crumpled bill on a café table.
 * What arrives is four points in the range 0..1 and no guarantee whatsoever
 * about their order, their sanity, or whether they describe a receipt at all —
 * so everything here is defensive, and a doubtful quad is refused rather than
 * cropped badly. A photo left uncropped is a small disappointment; a photo
 * cropped through the total is a wrong number in an expense claim.
 *
 * Pure maths, no image library: the caller feeds pixels through `homography`.
 */

/** Below this share of the frame, a "receipt" is more likely a misread. */
const MIN_AREA_FRACTION = 0.02;

/** A till roll is long, but not a ribbon. Guards against a collapsed quad. */
const MAX_ASPECT = 12;

/** Sort into top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(points) {
  const pts = points.map((p) => ({ x: Number(p.x), y: Number(p.y) }));

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  // Angle from the centre puts them in a ring; starting at the top-left one
  // makes that ring a consistent order.
  const withAngle = pts.map((p) => ({ ...p, a: Math.atan2(p.y - cy, p.x - cx) }));
  withAngle.sort((p, q) => p.a - q.a);

  let start = 0;
  let best = Infinity;
  withAngle.forEach((p, i) => {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2 + 0; // distance is a tiebreak only
    const isUpperLeft = p.x <= cx && p.y <= cy;
    const score = isUpperLeft ? -d : d;
    if (score < best) {
      best = score;
      start = i;
    }
  });

  return [0, 1, 2, 3].map((i) => {
    const { x, y } = withAngle[(start + i) % 4];
    return { x, y };
  });
}

function polygonArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * `{ ok, reason, corners }` — corners come back ordered when the quad passes.
 * Coordinates are expected in 0..1, as the models report them.
 */
export function validateQuad(points) {
  if (!Array.isArray(points) || points.length !== 4) {
    return { ok: false, reason: "not four points" };
  }

  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "not a number" };
    // A little slack: a receipt running off the edge is common and harmless.
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) {
      return { ok: false, reason: "outside the frame" };
    }
  }

  const corners = orderCorners(points);

  if (!isConvex(corners)) return { ok: false, reason: "edges cross" };

  const area = polygonArea(corners);
  if (area < MIN_AREA_FRACTION) return { ok: false, reason: "too small a share of the frame" };

  const width = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
  const height = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
  if (width <= 0 || height <= 0) return { ok: false, reason: "collapsed" };

  const aspect = Math.max(width / height, height / width);
  if (aspect > MAX_ASPECT) return { ok: false, reason: "implausible shape" };

  return { ok: true, corners };
}

/**
 * Output dimensions in pixels for a quad given in 0..1, against a source of
 * `srcWidth` x `srcHeight`. Each side takes the longer of its opposing pair so
 * a perspective squeeze is undone rather than baked in.
 */
export function outputSize(corners, srcWidth, srcHeight) {
  const px = corners.map((p) => ({ x: p.x * srcWidth, y: p.y * srcHeight }));

  const width = Math.max(dist(px[0], px[1]), dist(px[3], px[2]));
  const height = Math.max(dist(px[0], px[3]), dist(px[1], px[2]));

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * The 3x3 mapping from output pixel to source pixel, so the warp can be
 * written as a plain backwards sample: for every destination pixel, ask where
 * it came from. `src` is in source pixels, ordered TL, TR, BR, BL.
 */
export function homography(src, outWidth, outHeight) {
  const dst = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ];

  // Eight equations, eight unknowns: h33 is fixed at 1.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = dst[i];
    const { x, y } = src[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]);
    b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]);
    b.push(y);
  }

  const h = solve(A, b);
  if (!h) return null;
  return [...h, 1];
}

/** Where output pixel (x, y) lands in the source image. */
export function projectPoint(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  if (!w) return { x: 0, y: 0 };
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

/** Gaussian elimination with partial pivoting. Returns null on a singular system. */
function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }

  return m.map((row, i) => row[n] / row[i]);
}

/**
 * The quad that contains both readings.
 *
 * Two models are asked where the bill is, and they disagree by a percent or
 * two. Averaging would let one tight reading pull the crop into the print, so
 * each corner takes whichever model placed it further from the centre. A
 * disagreement can then only ever make the crop roomier, and the trim pass
 * that follows takes the slack back deterministically.
 */
export function unionQuad(...quads) {
  const valid = quads
    .map((q) => validateQuad(q))
    .filter((r) => r.ok)
    .map((r) => r.corners);

  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];

  const cx = valid.flat().reduce((s, p) => s + p.x, 0) / (valid.length * 4);
  const cy = valid.flat().reduce((s, p) => s + p.y, 0) / (valid.length * 4);

  return [0, 1, 2, 3].map((i) => {
    let furthest = valid[0][i];
    let best = -Infinity;
    for (const quad of valid) {
      const p = quad[i];
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d > best) {
        best = d;
        furthest = p;
      }
    }
    return furthest;
  });
}
