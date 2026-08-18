import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  orderCorners,
  validateQuad,
  outputSize,
  homography,
  projectPoint,
  unionQuad,
} from "../lib/receipt-geometry.js";

/** A receipt lying flat, slightly rotated, in a 1000x1000 photo. */
const TILTED = [
  { x: 0.22, y: 0.14 },
  { x: 0.78, y: 0.2 },
  { x: 0.74, y: 0.88 },
  { x: 0.18, y: 0.82 },
];

describe("orderCorners", () => {
  test("puts them in top-left, top-right, bottom-right, bottom-left order", () => {
    const shuffled = [TILTED[2], TILTED[0], TILTED[3], TILTED[1]];
    assert.deepEqual(orderCorners(shuffled), TILTED);
  });

  test("already ordered corners come back unchanged", () => {
    assert.deepEqual(orderCorners(TILTED), TILTED);
  });

  test("copes with a receipt photographed upside down", () => {
    const flipped = TILTED.map((p) => ({ x: 1 - p.x, y: 1 - p.y }));
    const ordered = orderCorners(flipped);
    // Top-left must genuinely be up and to the left of bottom-right.
    assert.ok(ordered[0].x < ordered[2].x);
    assert.ok(ordered[0].y < ordered[2].y);
  });
});

describe("validateQuad", () => {
  test("accepts a plausible receipt", () => {
    assert.equal(validateQuad(TILTED).ok, true);
  });

  test("rejects anything that is not four points", () => {
    assert.equal(validateQuad(TILTED.slice(0, 3)).ok, false);
    assert.equal(validateQuad(null).ok, false);
  });

  test("rejects coordinates outside the frame", () => {
    const outside = [...TILTED.slice(0, 3), { x: 1.4, y: 0.8 }];
    assert.equal(validateQuad(outside).ok, false);
  });

  test("rejects a sliver — a crop that small is a misread, not a receipt", () => {
    const sliver = [
      { x: 0.1, y: 0.1 },
      { x: 0.16, y: 0.1 },
      { x: 0.16, y: 0.2 },
      { x: 0.1, y: 0.2 },
    ];
    const r = validateQuad(sliver);
    assert.equal(r.ok, false);
    assert.match(r.reason, /small/i);
  });

  test("untangles a bow-tie rather than refusing it — the order was the problem", () => {
    const crossed = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ];
    const r = validateQuad(crossed);
    assert.equal(r.ok, true);
    assert.deepEqual(r.corners, [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ]);
  });

  test("rejects three points on a line, which no reordering can save", () => {
    const flat = [
      { x: 0.1, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.5 },
      { x: 0.5, y: 0.52 },
    ];
    assert.equal(validateQuad(flat).ok, false);
  });

  test("accepts a full-frame quad — a receipt can fill the photo", () => {
    const full = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    assert.equal(validateQuad(full).ok, true);
  });

  test("rejects a wildly implausible aspect ratio", () => {
    const ribbon = [
      { x: 0, y: 0.48 },
      { x: 1, y: 0.48 },
      { x: 1, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    assert.equal(validateQuad(ribbon).ok, false);
  });
});

describe("outputSize", () => {
  test("takes the longer of each opposing pair, so nothing is squashed", () => {
    const size = outputSize(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.6, y: 1 },
        { x: 0, y: 1 },
      ],
      1000,
      2000
    );
    assert.equal(size.width, 600); // the longer of the two horizontal edges
    // The slanted side is fractionally longer than the straight one, and it is
    // the one that must survive: shortening it would squash the text.
    assert.ok(size.height >= 2000 && size.height <= 2010);
  });

  test("never returns a zero dimension", () => {
    const size = outputSize(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      100,
      100
    );
    assert.ok(size.width >= 1 && size.height >= 1);
  });
});

describe("homography", () => {
  test("maps the output corners back onto the source corners", () => {
    const src = [
      { x: 100, y: 50 },
      { x: 700, y: 90 },
      { x: 660, y: 900 },
      { x: 60, y: 850 },
    ];
    const h = homography(src, 600, 800);

    const checks = [
      [{ x: 0, y: 0 }, src[0]],
      [{ x: 599, y: 0 }, src[1]],
      [{ x: 599, y: 799 }, src[2]],
      [{ x: 0, y: 799 }, src[3]],
    ];

    for (const [out, expected] of checks) {
      const p = projectPoint(h, out.x, out.y);
      assert.ok(Math.abs(p.x - expected.x) < 2, `x ${p.x} vs ${expected.x}`);
      assert.ok(Math.abs(p.y - expected.y) < 2, `y ${p.y} vs ${expected.y}`);
    }
  });

  test("an axis-aligned crop stays axis-aligned", () => {
    const src = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 220 },
      { x: 10, y: 220 },
    ];
    const h = homography(src, 100, 200);
    const mid = projectPoint(h, 50, 100);
    assert.ok(Math.abs(mid.x - 60) < 1);
    assert.ok(Math.abs(mid.y - 120) < 1);
  });
});

describe("unionQuad", () => {
  test("takes whichever reading placed each corner further out", () => {
    const tight = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    const loose = [
      { x: 0.15, y: 0.2 },
      { x: 0.85, y: 0.2 },
      { x: 0.8, y: 0.85 },
      { x: 0.2, y: 0.8 },
    ];
    assert.deepEqual(unionQuad(tight, loose), [
      { x: 0.15, y: 0.2 },
      { x: 0.85, y: 0.2 },
      { x: 0.8, y: 0.85 },
      { x: 0.2, y: 0.8 },
    ]);
  });

  test("one unusable reading does not spoil the other", () => {
    const good = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    assert.deepEqual(unionQuad(good, [{ x: 5, y: 5 }]), good);
  });

  test("no usable reading at all returns null rather than a guess", () => {
    assert.equal(unionQuad(null, [{ x: 0.1, y: 0.1 }]), null);
  });
});
