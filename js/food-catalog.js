export const MAX_FAVORITE_FOODS = 50;
export const FOOD_UNITS = ["g", "ml", "份", "个", "片", "杯", "袋"];
export const FOOD_NUTRIENTS = [
  { key: "kcal", label: "热量", unit: "kcal", max: 20000 },
  { key: "carbsG", label: "碳水", unit: "g", max: 5000 },
  { key: "proteinG", label: "蛋白质", unit: "g", max: 5000 },
  { key: "fatG", label: "脂肪", unit: "g", max: 5000 },
];
export function normalizeFavoriteFood(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const [key, max, required] of [["id", 80, true], ["name", 60, true], ["aliases", 100, false], ["note", 80, false]]) {
    const text = value[key] ?? "";
    if (typeof text !== "string" || text.length > max || (required && !text.trim())) return null;
    result[key] = text.trim();
  }
  if (!FOOD_UNITS.includes(value.servingUnit) || typeof value.servingAmount !== "number" || !Number.isFinite(value.servingAmount) || value.servingAmount < 0.1 || value.servingAmount > 10000) return null;
  result.servingAmount = Math.round(value.servingAmount * 10) / 10;
  result.servingUnit = value.servingUnit;
  for (const { key, max } of FOOD_NUTRIENTS) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > max) return null;
    result[key] = Math.round(value[key] * 10) / 10;
  }
  return result;
}
export function normalizeFoodCatalog(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.map(normalizeFavoriteFood).filter(food => {
    if (!food || ids.has(food.id)) return false;
    ids.add(food.id); return true;
  }).slice(0, MAX_FAVORITE_FOODS);
}
export function validateFoodReferences(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_FAVORITE_FOODS) throw new Error("常吃食物参考格式无效，最多 50 种");
  const result = normalizeFoodCatalog(value);
  if (result.length !== value.length) throw new Error("常吃食物的份量或营养数据无效，请检查后重试");
  return result;
}
export const foodServingLabel = food => `每 ${food.servingAmount} ${food.servingUnit}`;

// Keep the stored/AI value in kcal regardless of the packaging's energy unit.
export const KJ_PER_KCAL = 4.184;
export function foodEnergyToKcal(value, unit = "kcal") {
  if (!["kcal", "kJ"].includes(unit) || typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return unit === "kJ" ? value / KJ_PER_KCAL : value;
}
export function foodEnergyFromKcal(value, unit = "kcal") {
  if (foodEnergyToKcal(value, unit) === null) return null;
  return unit === "kJ" ? value * KJ_PER_KCAL : value;
}
