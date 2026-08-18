import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assessSyncHealth, shouldSyncBeforeGivingUp } from "../lib/sync-health.js";

const NOW = "2026-08-18T12:00:00Z";
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

describe("assessSyncHealth", () => {
  test("a sync from this morning is healthy and silent", () => {
    const r = assessSyncHealth({ lastSyncedAt: hoursAgo(6), now: NOW });
    assert.equal(r.stale, false);
    assert.equal(r.shouldAlert, false);
  });

  test("no sync for two days is stale", () => {
    const r = assessSyncHealth({ lastSyncedAt: hoursAgo(50), now: NOW });
    assert.equal(r.stale, true);
    assert.equal(r.shouldAlert, true);
    assert.match(r.message, /2 days/);
  });

  test("a batch failure alerts immediately, however recent the sync", () => {
    const r = assessSyncHealth({ lastSyncedAt: hoursAgo(1), now: NOW, hadBatchFailure: true });
    assert.equal(r.shouldAlert, true);
    assert.match(r.message, /could not be read/i);
  });

  test("never having synced is stale, not a crash", () => {
    const r = assessSyncHealth({ lastSyncedAt: null, now: NOW });
    assert.equal(r.stale, true);
    assert.equal(r.shouldAlert, true);
  });

  test("stays quiet if it already complained today", () => {
    const r = assessSyncHealth({
      lastSyncedAt: hoursAgo(60),
      now: NOW,
      lastAlertAt: hoursAgo(3),
    });
    assert.equal(r.stale, true);
    assert.equal(r.shouldAlert, false);
  });

  test("complains again once the cooldown has passed", () => {
    const r = assessSyncHealth({
      lastSyncedAt: hoursAgo(60),
      now: NOW,
      lastAlertAt: hoursAgo(30),
    });
    assert.equal(r.shouldAlert, true);
  });

  test("a batch failure still respects the cooldown", () => {
    const r = assessSyncHealth({
      lastSyncedAt: hoursAgo(1),
      now: NOW,
      hadBatchFailure: true,
      lastAlertAt: hoursAgo(2),
    });
    assert.equal(r.shouldAlert, false);
  });

  test("the window is configurable", () => {
    const r = assessSyncHealth({ lastSyncedAt: hoursAgo(30), now: NOW, staleAfterHours: 24 });
    assert.equal(r.stale, true);
  });
});

describe("shouldSyncBeforeGivingUp", () => {
  test("an unmatched receipt with nothing to compare against triggers a sync", () => {
    const r = shouldSyncBeforeGivingUp({
      verdict: { action: "defer", candidates: [] },
      lastSyncedAt: hoursAgo(5),
      now: NOW,
    });
    assert.equal(r, true);
  });

  test("a matched receipt never triggers one", () => {
    const r = shouldSyncBeforeGivingUp({
      verdict: { action: "auto", candidates: [{}] },
      lastSyncedAt: hoursAgo(5),
      now: NOW,
    });
    assert.equal(r, false);
  });

  test("candidates found but none good enough is a scoring problem, not a stale ledger", () => {
    const r = shouldSyncBeforeGivingUp({
      verdict: { action: "ask", candidates: [{}, {}] },
      lastSyncedAt: hoursAgo(5),
      now: NOW,
    });
    assert.equal(r, false);
  });

  test("does not sync again within the cooldown — a bulk upload must not fire one per photo", () => {
    const r = shouldSyncBeforeGivingUp({
      verdict: { action: "defer", candidates: [] },
      lastSyncedAt: hoursAgo(0.05),
      now: NOW,
    });
    assert.equal(r, false);
  });

  test("a ledger that has never synced still triggers one", () => {
    const r = shouldSyncBeforeGivingUp({
      verdict: { action: "defer", candidates: [] },
      lastSyncedAt: null,
      now: NOW,
    });
    assert.equal(r, true);
  });
});
