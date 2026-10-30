import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlans, planMatchesRecord, planRecordCount, enabledPlans } from "../js/supplement-plan.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { toDateKey, fromDateKey, isWeekday } from "../js/utils.js";
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

test("plan references allow legacy slash IDs without relaxing record document ID validation", () => {
  const backup = { profile: { medicines: [{ id: "legacy:medicine:维C/锌", name: "维C/锌", targetCount: 2 }] }, records: { "2026-10-20": { medicine: [{ id: "dose", name: "维C/锌", planId: "legacy:medicine:维C/锌", count: 1, recordedAt: "2026-10-20T12:00:00Z" }] } } };
  const parsed = parseBackup(backup);
  assert.equal(parsed.data.profile.medicines[0].id, "legacy:medicine:维C/锌");
  backup.records["2026-10-20"].medicine[0].id = "invalid/document";
  assert.throws(() => parseBackup(backup));
});

test("day counters and statistics sum every matching medicine and supplement dose", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8"), configs = [];
  const medicines = [{ id: "medicine", name: "renamed", legacyNames: ["old"], targetCount: 2, schedule: "everyday" }];
  const supplements = [{ id: "supplement", name: "supplement", targetCount: 2, schedule: "everyday" }];
  const medRecs = [{ name: "old", count: 1 }, { name: "renamed", planId: "medicine", count: 1 }, { name: "renamed", planId: "unrelated", count: 5 }];
  const suppRecs = [{ name: "supplement", planId: "supplement", count: 1 }, { name: "supplement", planId: "supplement", count: 1 }];
  const context = vm.createContext({ userMedicines: medicines, userSupplements: supplements, medicineRecords: medRecs, supplementRecords: suppRecs,
    DEFAULT_MEDICINES: [], DEFAULT_SUPPLEMENTS: [], enabledPlans, planMatchesRecord, planRecordCount, toDateKey, fromDateKey, isWeekday,
    statsChart: null, complianceChart: null, dailyGoal: 2000, isItemActiveOnDay: () => true,
    storage: { getHistory: async dates => dates.map(dateKey => ({ dateKey, waterTotal: 0, medRecs, suppRecs, isWorkout: false })) },
    E: { waterChart: { getContext: () => ({}) }, complianceChart: { getContext: () => ({}) } },
    t: key => key === "weekdays" ? ["日", "一", "二", "三", "四", "五", "六"] : key, getLang: () => "zh",
    currentTheme: () => ({ accent: "#fff", secondary: "#aaa", soft: "#eee" }), document: { body: {} }, getComputedStyle: () => ({ getPropertyValue: () => "" }),
    Chart: class { constructor(_, config) { configs.push(config); } destroy() {} },
  });
  vm.runInContext(source.slice(source.indexOf("function getCfg(type)"), source.indexOf("async function adjustIntake")), context);
  vm.runInContext(source.slice(source.indexOf("async function renderStatsChart("), source.indexOf("// ========== 设置")), context);
  assert.equal(context.getCount("medicine", "renamed"), 2);
  assert.equal(context.getCount("supplement", "supplement"), 2);
  await context.renderStatsChart("week");
  for (const dataset of configs[1].data.datasets) assert.ok(dataset.data.every(value => value === 100));
});

test("meal cache deletions refresh the dashboard without overwriting a newer write, day load or account", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  for (const change of ["none", "write", "load", "date", "account"]) {
    const window = new EventTarget(), date = "2026-10-20";
    let release, rendered = 0;
    const context = vm.createContext({ window, selectedDate: date, requestVersion: 3, mealRecords: [{ id: "old" }],
      storage: { sync: { generation: 1 }, dayRevisions: new Map([[date, 1]]), getCachedMealLogs: () => new Promise(resolve => { release = resolve; }) },
      renderMeals: () => rendered++, updateDailyOverview: () => rendered++,
    });
    vm.runInContext(source.slice(source.indexOf('window.addEventListener("meal-cache-change"'), source.indexOf('window.addEventListener("online"')), context);
    window.dispatchEvent(new Event("meal-cache-change"));
    if (change === "write") context.storage.dayRevisions.set(date, 2);
    if (change === "load") context.requestVersion++;
    if (change === "date") context.selectedDate = "2026-10-21";
    if (change === "account") context.storage.sync.generation++;
    context.mealRecords = [{ id: "latest" }];
    release([]); await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.mealRecords.length, change === "none" ? 0 : 1);
    assert.equal(rendered, change === "none" ? 2 : 0);
  }
});
