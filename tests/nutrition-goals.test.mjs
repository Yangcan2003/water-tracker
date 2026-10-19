import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NUTRITION_RATIOS, normalizeNutritionGoal, nutritionTargets, nutritionGoalProgress, dailyNutritionGoals, dailyNutrientProgress } from "../js/nutrition-goals.js";

test("daily grams use the selected weight and independent per-kg ratios without floating point artifacts", () => {
  assert.deepEqual(nutritionTargets({ weightKg: 70, ratios: DEFAULT_NUTRITION_RATIOS }), { carbsG: 210, proteinG: 112, fatG: 56 });
  assert.deepEqual(nutritionTargets({ weightKg: 65.3, ratios: DEFAULT_NUTRITION_RATIOS }), { carbsG: 195.9, proteinG: 104.5, fatG: 52.2 });
  assert.deepEqual(nutritionTargets({ weightKg: 80, ratios: { carbsG: 2.5, proteinG: 2, fatG: 1 } }), { carbsG: 200, proteinG: 160, fatG: 80 });
});
test("missing or invalid targets stay unset instead of inventing a body weight", () => {
  for (const weightKg of [undefined, null, "", "70", NaN, Infinity, 0, -70, 1001]) assert.equal(normalizeNutritionGoal({ weightKg, ratios: DEFAULT_NUTRITION_RATIOS }), null);
  for (const ratios of [{}, { ...DEFAULT_NUTRITION_RATIOS, carbsG: -1 }, { ...DEFAULT_NUTRITION_RATIOS, fatG: NaN }, { carbsG: 0, proteinG: 0, fatG: 0 }]) assert.equal(normalizeNutritionGoal({ weightKg: 70, ratios }), null);
  assert.equal(nutritionTargets(null), null);
});
test("progress distinguishes unknown, real zero, remaining and excess without overflowing bars", () => {
  assert.equal(nutritionGoalProgress(null, 210), null);
  assert.deepEqual(nutritionGoalProgress(0, 210), { percent: 0, remaining: 210, over: 0 });
  assert.deepEqual(nutritionGoalProgress(62, 210), { percent: 30, remaining: 148, over: 0 });
  assert.deepEqual(nutritionGoalProgress(210, 210), { percent: 100, remaining: 0, over: 0 });
  assert.deepEqual(nutritionGoalProgress(245.5, 210), { percent: 100, remaining: 0, over: 35.5 });
  assert.deepEqual(nutritionGoalProgress(1, 0), { percent: 100, remaining: 0, over: 1 });
});


test("fiber minimum and sodium limit default independently of body weight and preserve saved custom goals", () => {
  assert.deepEqual(dailyNutritionGoals(null), { fiberG: 25, sodiumMg: 2000 });
  const legacy = { weightKg: 70, ratios: DEFAULT_NUTRITION_RATIOS };
  assert.deepEqual(normalizeNutritionGoal(legacy), legacy);
  const custom = { ...legacy, daily: { fiberG: 30, sodiumMg: 1800 } };
  assert.deepEqual(normalizeNutritionGoal(custom), custom);
  assert.deepEqual(dailyNutritionGoals({ ...custom, weightKg: 90 }), custom.daily);
  assert.deepEqual(nutritionTargets(custom), nutritionTargets(legacy));
  for (const value of [null, "30", -1, 0, 0.01, NaN, Infinity, 100001]) {
    assert.deepEqual(dailyNutritionGoals({ daily: { fiberG: value, sodiumMg: value } }), { fiberG: 25, sodiumMg: 2000 });
  }
});

test("fiber and sodium distinguish unknown, zero, partial records, goal attainment and approaching/exceeding the limit", () => {
  const totals = { entries: 2, nutrientCoverage: { fiberG: 1, sodiumMg: 1 }, fiberG: 10, sodiumMg: 1600 };
  const fiber = dailyNutrientProgress(totals, "fiberG", 25);
  assert.equal(fiber.incomplete, true); assert.equal(fiber.progress.remaining, 15); assert.equal(fiber.state, "below");
  assert.equal(dailyNutrientProgress(totals, "sodiumMg", 2000).state, "near");
  const zero = dailyNutrientProgress({ ...totals, sodiumMg: 0 }, "sodiumMg", 2000);
  assert.equal(zero.intake, 0); assert.equal(zero.progress.percent, 0); assert.equal(zero.incomplete, true);
  const unknown = dailyNutrientProgress({ entries: 2, sodiumMg: null }, "sodiumMg", 2000);
  assert.equal(unknown.state, "unknown"); assert.equal(unknown.progress, null);
  const complete = { entries: 2, nutrientCoverage: { fiberG: 2, sodiumMg: 2 }, fiberG: 25, sodiumMg: 2000 };
  assert.equal(dailyNutrientProgress(complete, "fiberG", 25).state, "met");
  assert.equal(dailyNutrientProgress(complete, "fiberG", 25).incomplete, false);
  assert.equal(dailyNutrientProgress(complete, "sodiumMg", 2000).state, "limit");
  const excess = dailyNutrientProgress({ ...complete, sodiumMg: 2300 }, "sodiumMg", 2000);
  assert.equal(excess.progress.over, 300); assert.equal(excess.progress.percent, 100);
});
