import { dailyNutritionGoals, nutritionTargets, nutritionGoalProgress } from "./nutrition-goals.js";

const format = value => value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export function dashboardNutritionText(totals, goal, loading = false) {
  if (loading) return "正在读取营养记录…";
  const targets = nutritionTargets(goal), daily = dailyNutritionGoals(goal);
  const result = [];
  for (const [key, label, target, unit] of [["proteinG", "蛋白质", targets?.proteinG, "g"], ["fiberG", "纤维", daily.fiberG, "g"], ["sodiumMg", "钠", daily.sodiumMg, "mg"]]) {
    if (target == null) continue;
    const progress = nutritionGoalProgress(totals[key], target);
    const incomplete = key === "proteinG" ? totals.missing > 0 : (totals.nutrientCoverage?.[key] || 0) < (totals.entries || 0);
    if (!progress) { result.push(`${label}待补充数据`); continue; }
    const status = progress.over ? `已超 ${format(progress.over)} ${unit}` : key === "sodiumMg" ? progress.remaining ? `剩余 ${format(progress.remaining)} ${unit}` : "已到上限" : progress.remaining ? `还差 ${format(progress.remaining)} ${unit}` : "已达目标";
    result.push(`${label}${status}${incomplete ? "（仅已知摄入）" : ""}`);
  }
  return result.join(" · ");
}
