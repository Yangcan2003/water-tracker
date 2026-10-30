import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlans, planMatchesRecord } from "../js/supplement-plan.js";
import { dashboardNutritionText } from "../js/dashboard-nutrition.js";
import { parseBackup, planBackupRestore } from "../js/data-backup.js";

test("renaming a legacy plan retains old doses and new stable-ID doses, while a newly created namesake stays separate", () => {
  const original = normalizePlans([{ name: "old", targetCount: 2 }], "medicine")[0];
  const renamed = { ...original, name: "new" };
  assert.equal(planMatchesRecord(renamed, { name: "old", count: 1 }), true);
  assert.equal(planMatchesRecord(renamed, { name: "anything", planId: original.id }), true);
  assert.equal(planMatchesRecord({ id: "new-plan", name: "old", legacyNames: [] }, { name: "old", count: 1 }), false);
  assert.equal(planMatchesRecord(renamed, { name: "new", planId: "other" }), false);
});

test("dashboard remaining values distinguish unknown, incomplete and exceeded nutrient data", () => {
  const goal = { weightKg: 60, ratios: { proteinG: 1.5, carbsG: 3, fatG: 0.8 } };
  const totals = { entries: 2, counted: 1, missing: 1, proteinG: 30, fiberG: 10, sodiumMg: 2100, nutrientCoverage: { fiberG: 1, sodiumMg: 1 } };
  const text = dashboardNutritionText(totals, goal);
  assert.match(text, /蛋白质还差 60 g（仅已知摄入）/);
  assert.match(text, /纤维还差 15 g/); assert.match(text, /钠已超 100 mg/);
  assert.match(dashboardNutritionText({}, goal), /待补充数据/);
  assert.equal(dashboardNutritionText(totals, goal, true), "正在读取营养记录…");
});

test("backup validation rejects malformed records, unsupported versions, missing images and dangerous IDs", () => {
  const base = { profile: {}, records: { "2026-10-20": { water: [{ id: "water", source: "杯", amount: 400, recordedAt: "2026-10-20T10:00:00Z" }] } } };
  assert.equal(parseBackup(base).version, 2);
  for (const patch of [row => { row.id = "__proto__"; }, row => { row.amount = -100; }, row => { row.recordedAt = "invalid"; }]) {
    const invalid = structuredClone(base); patch(invalid.records["2026-10-20"].water[0]); assert.throws(() => parseBackup(invalid));
  }
  assert.throws(() => parseBackup({ format: "health-tracker-backup", version: 99, data: base }), /版本/);
  assert.throws(() => parseBackup({ profile: {}, records: { "2026-10-20": { meal: [{ id: "meal", name: "饭", photoIds: ["missing"], recordedAt: new Date() }] } } }));
  const first = parseBackup(base).data, second = structuredClone(first); second.records["2026-10-20"].water[0].id = "new-id";
  assert.equal(planBackupRestore(first, second).counts.duplicates, 1);
});
