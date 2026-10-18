import test from "node:test";
import assert from "node:assert/strict";
import { awaitAssistantOperation, formatAssistantText } from "../js/assistant-ui.js";
import { ASSISTANT_CATEGORIES, assistantHistoryRange, buildHealthContext } from "../js/assistant-context.js";

test("a stalled native operation releases the UI on cancellation and rejects late answers", async () => {
  const abort = new AbortController(); let resolve;
  const response = awaitAssistantOperation(new Promise(done => { resolve = done; }), abort.signal);
  abort.abort("user");
  await assert.rejects(response, { name: "AbortError" });
  resolve({ reply: "late" });
  assert.equal(await awaitAssistantOperation(Promise.resolve("ok")), "ok");
});
test("model formatting permits readable lists and emphasis but escapes HTML", () => {
  const html = formatAssistantText('### 提示\n\n- **喝水**\n- <img src=x onerror=alert(1)>\n\n`<script>`');
  assert.match(html, /<h3>提示<\/h3>/); assert.match(html, /<strong>喝水<\/strong>/);
  assert.match(html, /<ul><li>/); assert.ok(!html.includes("<img")); assert.ok(!html.includes("<script>"));
});
test("all-history health context includes every category and dated measurements without account or photo fields", () => {
  const categories = ASSISTANT_CATEGORIES.map(item => item.key), now = new Date(2026, 9, 15);
  assert.deepEqual(assistantHistoryRange("all", now), { startDate: "0001-01-01", endDate: "2026-10-15" });
  const days = [{ dateKey: "2025-01-01", waterRecs: [{ amount: 200, uid: "secret-uid" }], medRecs: [{ name: "药物 A", count: 2, dosage: "记录剂量" }], suppRecs: [{ name: "补剂 B", count: 1 }], toiletRecs: [{ type: "small" }], mealRecs: [{ mealType: "lunch", name: "午餐", photos: ["secret-photo"] }], isWorkout: true, workoutDetail: { activity: "步行", duration: 20 } }];
  const context = buildHealthContext(days, { rangeDays: "all", categories, compact: true, now, profile: { dailyGoal: 2000, email: "secret-email" }, bodyMeasurements: { a: { id: "a", date: "2024-01-01", weight: 60 }, b: { id: "b", date: "2026-10-16", weight: 61 }, c: { id: "c", date: "2023-01-01", weight: 62, deleted: true } } });
  assert.equal(context.range.startDate, "2024-01-01"); assert.deepEqual(context.categories, categories);
  for (const key of ["water", "medicine", "supplement", "toilet", "meal", "workout"]) assert.ok(context.days[0][key]);
  assert.equal(context.bodyMeasurements.length, 1); assert.equal(context.dailyWaterGoalMl, 2000);
  assert.ok(!JSON.stringify(context).includes("secret-"));
});
test("large histories summarize all recorded dates instead of truncating to recent days", () => {
  const days = Array.from({ length: 400 }, (_, index) => {
    const date = new Date(2025, 0, 1 + index), dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { dateKey, waterRecs: Array.from({ length: 5 }, () => ({ amount: 100 })), mealRecs: [{ name: "食物".repeat(60), note: "备注".repeat(60), mealType: "lunch" }], toiletRecs: [{ type: "big" }] };
  });
  const context = buildHealthContext(days, { rangeDays: "all", categories: ASSISTANT_CATEGORIES.map(item => item.key), compact: true, now: new Date(2026, 9, 15) });
  assert.ok(context.summarized); assert.ok(JSON.stringify(context).length <= 18000);
  assert.equal(context.days.reduce((sum, item) => sum + item.recordedDays, 0), 400);
  assert.equal(context.days.reduce((sum, item) => sum + item.water.totalMl, 0), 200000);
  assert.match(context.note, /原始明细/);
});

test("fresh context carries saved meal nutrition, today's totals and user targets without inventing missing values", () => {
  const now = new Date(2026, 9, 17, 22, 30), options = { rangeDays: "all", categories: ["meal"], compact: true, now,
    profile: { nutritionGoal: { weightKg: 70, ratios: { carbsG: 3, proteinG: 1.6, fatG: 0.8 } }, email: "private-email" } };
  const days = [{ dateKey: "2026-10-17", mealRecs: [
    { name: "晚餐", nutrition: { kcal: 800, carbsG: 60, proteinG: 30, fatG: 77, portion: "一份", source: "ai", token: "private-token" }, photos: ["private-photo"] },
    { name: "未估算的小食" },
  ] }, { dateKey: "2026-10-16", mealRecs: [{ name: "昨天", nutrition: { kcal: 600, carbsG: 50, proteinG: 20, fatG: 20 } }] }];
  const before = buildHealthContext(days, options);
  assert.equal(before.snapshot.localDate, "2026-10-17"); assert.equal(before.snapshot.generatedAt, now.toISOString());
  assert.equal(before.todayNutrition.fatG, 77); assert.equal(before.todayNutrition.counted, 1); assert.equal(before.todayNutrition.missing, 1);
  assert.equal(before.todayNutrition.estimatedEntries, 1); assert.equal(before.days[0].meal.entries[0].nutrition.portion, "一份");
  assert.deepEqual(before.dailyNutritionTargetsG, { carbsG: 210, proteinG: 112, fatG: 56 });
  assert.ok(!JSON.stringify(before).includes("private-"));
  days[0].mealRecs[0].nutrition.fatG = 85;
  assert.equal(buildHealthContext(days, options).todayNutrition.fatG, 85);
  const unknown = buildHealthContext([{ dateKey: "2026-10-17", mealRecs: [{ name: "未知" }] }], options);
  assert.equal(unknown.todayNutrition.fatG, null); assert.equal(unknown.todayNutrition.missing, 1);
  const excluded = buildHealthContext(days, { ...options, categories: ["water"] });
  assert.equal(excluded.todayNutrition, undefined); assert.equal(excluded.dailyNutritionTargetsG, undefined);
});

test("all-history compression preserves today's nutrition and totals from every older date", () => {
  const days = Array.from({ length: 500 }, (_, index) => {
    const date = new Date(2025, 0, 1 + index), dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { dateKey, mealRecs: [{ name: "食物".repeat(80), nutrition: { kcal: 100, carbsG: 10, proteinG: 5, fatG: 3 } }] };
  });
  days.push({ dateKey: "2026-10-17", mealRecs: [{ name: "今天", nutrition: { kcal: 500, carbsG: 50, proteinG: 20, fatG: 85 } }] });
  const context = buildHealthContext(days, { rangeDays: "all", categories: ["meal"], compact: true, now: new Date(2026, 9, 17) });
  assert.ok(context.summarized); assert.ok(JSON.stringify(context).length <= 18000);
  assert.equal(context.todayNutrition.fatG, 85);
  assert.equal(context.days.reduce((sum, day) => sum + day.meal.nutrition.fatG, 0), 1585);
});


test("health assistant includes current favorite foods independently of meal dates and never counts them as intake", () => {
  const favorite = { id: "private-food-id", name: "测试冰烤薯", aliases: "测试品牌冰薯", servingAmount: 100, servingUnit: "g", kcal: 100, carbsG: 23, proteinG: 1, fatG: 0, note: "营养表每100g", token: "private-food-token" };
  const profile = { foodCatalog: [favorite], email: "private-email" };
  const options = { profile, categories: ["meal"], rangeDays: 1, now: new Date(2026, 9, 18), compact: true };
  const first = buildHealthContext([], options);
  assert.equal(first.foodCatalog.count, 1);
  assert.equal(first.foodCatalog.entries[0].name, "测试冰烤薯");
  assert.equal(first.foodCatalog.entries[0].servingAmount, 100);
  assert.equal(first.foodCatalog.entries[0].servingUnit, "g");
  assert.equal(first.foodCatalog.entries[0].kcal, 100);
  assert.equal(first.foodCatalog.entries[0].fatG, 0);
  assert.equal(first.todayNutrition.kcal, null);
  assert.equal(first.todayNutrition.entries, 0);
  assert.ok(!JSON.stringify(first).includes("private-"));
  profile.foodCatalog[0].carbsG = 25;
  assert.equal(buildHealthContext([], options).foodCatalog.entries[0].carbsG, 25);
  assert.equal(first.foodCatalog.entries[0].carbsG, 23);
  assert.equal(buildHealthContext([], { ...options, categories: ["water"] }).foodCatalog, undefined);
  assert.equal(buildHealthContext([], { ...options, profile: { foodCatalog: [] } }).foodCatalog.count, 0);
});

test("large all-history snapshots retain every favorite food, unit, alias, note and nutrient within the context budget", () => {
  const foods = Array.from({ length: 50 }, (_, i) => ({ id: `food-${i}`, name: `${i}`.padEnd(60, "食"), aliases: "别".repeat(100), note: "注".repeat(80), servingAmount: 100, servingUnit: "g", kcal: 123.4, carbsG: 23.4, proteinG: 12.3, fatG: 3.4 }));
  const days = Array.from({ length: 500 }, (_, i) => { const date = new Date(2025, 0, i + 1); return { dateKey: date.toISOString().slice(0, 10), mealRecs: [{ name: "历史食物".repeat(30), note: "备注".repeat(80), nutrition: { kcal: 100, carbsG: 10, proteinG: 5, fatG: 3 } }] }; });
  const context = buildHealthContext(days, { rangeDays: "all", categories: ["meal"], now: new Date(2026, 9, 18), profile: { foodCatalog: foods }, compact: true });
  assert.ok(JSON.stringify(context).length <= 18000);
  assert.equal(context.foodCatalog.count, 50);
  assert.equal(context.foodCatalog.rows.length, 50);
  for (const [i, row] of context.foodCatalog.rows.entries()) {
    const reference = Object.fromEntries(context.foodCatalog.columns.map((key, j) => [key, row[j]]));
    for (const key of context.foodCatalog.columns) assert.equal(reference[key], foods[i][key]);
  }
  assert.equal(context.days.reduce((sum, day) => sum + day.meal.nutrition.kcal, 0), 50000);
});
