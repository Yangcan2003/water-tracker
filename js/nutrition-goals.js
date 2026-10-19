export const DEFAULT_NUTRITION_RATIOS = { carbsG: 3, proteinG: 1.6, fatG: 0.8 };
export const DEFAULT_DAILY_NUTRIENTS = { fiberG: 25, sodiumMg: 2000 };
export const DAILY_NUTRIENT_GOALS = [
  { key: "fiberG", id: "Fiber", label: "膳食纤维", unit: "g", max: 1000, kind: "minimum" },
  { key: "sodiumMg", id: "Sodium", label: "钠", unit: "mg", max: 100000, kind: "limit" },
];
export function dailyNutritionGoals(value) {
  return Object.fromEntries(DAILY_NUTRIENT_GOALS.map(({ key, max }) => {
    const amount = value?.daily?.[key];
    return [key, typeof amount === "number" && Number.isFinite(amount) && amount >= (key === "sodiumMg" ? 1 : 0.1) && amount <= max
      ? Math.round(amount * (key === "sodiumMg" ? 1 : 10)) / (key === "sodiumMg" ? 1 : 10) : DEFAULT_DAILY_NUTRIENTS[key]];
  }));
}
// Coverage includes every meal, including ones without any nutrition analysis.
export function dailyNutrientProgress(totals, key, target) {
  const intake = totals[key] ?? null, entries = totals.entries || 0;
  const coverage = totals.nutrientCoverage?.[key] || 0;
  const progress = nutritionGoalProgress(intake, target);
  const incomplete = coverage < entries;
  const isLimit = key === "sodiumMg";
  const state = !progress ? "unknown" : isLimit
    ? intake >= target ? "limit" : intake >= target * 0.8 ? "near" : "within"
    : intake >= target ? "met" : "below";
  return { intake, entries, coverage, incomplete, progress, state };
}
export const GOAL_MACROS = [
  { key: "carbsG", label: "碳水", id: "Carbs" },
  { key: "proteinG", label: "蛋白质", id: "Protein" },
  { key: "fatG", label: "脂肪", id: "Fat" },
];
export function normalizeNutritionGoal(value) {
  if (!value || typeof value.weightKg !== "number" || !Number.isFinite(value.weightKg) || value.weightKg < 0.1 || value.weightKg > 1000) return null;
  const ratios = {};
  for (const { key } of GOAL_MACROS) {
    const ratio = value.ratios?.[key];
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 10) return null;
    ratios[key] = Math.round(ratio * 10) / 10;
  }
  if (!Object.values(ratios).some(Boolean)) return null;
  return { weightKg: Math.round(value.weightKg * 10) / 10, ratios, ...(value.daily ? { daily: dailyNutritionGoals(value) } : {}) };
}
export function nutritionTargets(value) {
  const goal = normalizeNutritionGoal(value);
  return goal ? Object.fromEntries(GOAL_MACROS.map(({ key }) => [key, Math.round(goal.weightKg * goal.ratios[key] * 10) / 10])) : null;
}
export function nutritionGoalProgress(intake, target) {
  if (intake == null || !Number.isFinite(intake) || intake < 0) return null;
  const difference = Math.round((target - intake) * 10) / 10;
  return { percent: target > 0 ? Math.min(100, Math.round(intake / target * 100)) : intake > 0 ? 100 : 0,
    remaining: Math.max(0, difference), over: Math.max(0, -difference) };
}
