import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NUTRITION_RATIOS, normalizeNutritionGoal, nutritionTargets, nutritionGoalProgress } from "../js/nutrition-goals.js";

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
