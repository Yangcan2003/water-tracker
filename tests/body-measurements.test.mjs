import test from "node:test";
import assert from "node:assert/strict";
import { validateMeasurement, mergeMeasurements, measurementHistory, latestMeasurements } from "../js/body-measurements.js";

test("body records allow partial measurements but reject blank, invalid dates and numbers", () => {
  assert.deepEqual(validateMeasurement({ date: "2026-10-01", weight: "65.2", height: "", bodyFat: "" }, "2026-10-12"), { date: "2026-10-01", weight: 65.2, height: null, bodyFat: null });
  for (const input of [
    { date: "2026-10-01" }, { date: "2026-02-30", weight: 65 },
    { date: "2026-10-13", weight: 65 }, { date: "invalid", weight: 65 },
    { date: "2026-10-01", weight: 0 }, { date: "2026-10-01", weight: "NaN" },
    { date: "2026-10-01", weight: 65.25 }, { date: "2026-10-01", bodyFat: 101 },
    { date: "2026-10-01", height: 301 },
  ]) assert.throws(() => validateMeasurement(input, "2026-10-12"));
});

test("latest values are selected separately by measurement date; backfills and same-day saves keep history", () => {
  const map = {
    a: { date: "2026-10-01", height: 175, weight: 66, bodyFat: 20, createdAt: "2026-10-01T00:00:00Z" },
    b: { date: "2026-10-10", height: null, weight: 65, bodyFat: null, createdAt: "2026-10-10T00:00:00Z" },
    c: { date: "2026-09-15", height: 174, weight: 68, bodyFat: 22, createdAt: "2026-10-12T00:00:00Z" },
    d: { date: "2026-10-10", weight: 64.9, createdAt: "2026-10-10T01:00:00Z" },
  };
  assert.deepEqual(measurementHistory(map).map(record => record.id), ["d", "b", "a", "c"]);
  const latest = latestMeasurements(map);
  assert.equal(latest.height.height, 175);
  assert.equal(latest.weight.weight, 64.9);
  assert.equal(latest.bodyFat.bodyFat, 20);
});

test("merging devices keeps distinct entries and deletion tombstones stop stale records returning", () => {
  const entry = { date: "2026-10-01", weight: 65, updatedAt: "2026-10-01T00:00:00Z" };
  const removed = { ...entry, deleted: true, updatedAt: "2026-10-02T00:00:00Z" };
  const merged = mergeMeasurements({ a: entry }, { b: entry, a: removed }, { a: entry });
  assert.deepEqual(measurementHistory(merged).map(record => record.id), ["b"]);
  assert.equal(merged.a.deleted, true);
  assert.equal(mergeMeasurements({ a: { ...entry, deleted: true } }, { a: entry }).a.deleted, true);
});
