import { historyRange, inHistoryRange } from "./history-range.js";
import { measurementHistory } from "./body-measurements.js";
import { toDateKey } from "./utils.js";
import { dailyMealNutrition, normalizeMealNutrition } from "./meal-nutrition.js";
import { nutritionTargets, dailyNutritionGoals } from "./nutrition-goals.js";
import { FOOD_NUTRIENTS, normalizeFoodCatalog } from "./food-catalog.js";

export const ASSISTANT_CATEGORIES = [
  { key: "water", label: "饮水" }, { key: "meal", label: "饮食" }, { key: "workout", label: "训练" },
  { key: "body", label: "身体档案" }, { key: "medicine", label: "药物" }, { key: "supplement", label: "补剂" }, { key: "toilet", label: "如厕" },
];
const text = value => String(value || "").slice(0, 160);
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
function time(record) {
  const raw = record?.recordedAt;
  if (!raw) return null;
  const date = raw.toDate?.() || new Date(typeof raw.seconds === "number" ? raw.seconds * 1000 : raw);
  return Number.isNaN(date.getTime()) ? null : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function logList(records, map) {
  return { count: records.length, entries: records.slice(0, 30).map(map), omitted: Math.max(0, records.length - 30) };
}
function mealNutrition(record) {
  const value = normalizeMealNutrition(record.nutrition);
  if (!value) return null;
  return { ...Object.fromEntries(FOOD_NUTRIENTS.map(({ key }) => [key, value[key]])),
    portion: text(value.portion), note: text(value.note), source: value.source, estimatedAt: text(value.estimatedAt) };
}
function nutritionSummary(records) {
  return { ...dailyMealNutrition(records), estimatedEntries: records.filter(record => {
    const value = normalizeMealNutrition(record.nutrition); return value && value.source === "ai";
  }).length };
}

export function assistantHistoryRange(days, now = new Date()) {
  return days === "all" ? { startDate: "0001-01-01", endDate: toDateKey(now) } : historyRange(Number(days), now);
}

export function buildHealthContext(days, { rangeDays = 7, categories = ["water", "meal", "workout", "body"], bodyMeasurements = {}, profile = {}, compact = false, now = new Date() } = {}) {
  if (![1, 7, 30, "all"].includes(rangeDays)) throw new Error("请选择今天、最近 7 天、最近 30 天或全部历史");
  const selected = ASSISTANT_CATEGORIES.filter(item => categories.includes(item.key)).map(item => item.key);
  if (!selected.length) throw new Error("请至少选择一类记录");
  const measurements = measurementHistory(bodyMeasurements);
  const range = assistantHistoryRange(rangeDays, now);
  const selectedDays = days.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day.dateKey) && inHistoryRange(day.dateKey, range));
  if (rangeDays === "all") range.startDate = [...selectedDays.map(day => day.dateKey), ...(selected.includes("body") ? measurements.filter(item => item.date <= range.endDate).map(item => item.date) : []), range.endDate].sort()[0];
  const snapshots = selectedDays.map(day => {
    const result = { date: day.dateKey };
    if (selected.includes("water") && day.waterRecs?.length) result.water = { totalMl: day.waterRecs.reduce((sum, record) => sum + (number(record.amount) || 0), 0), ...logList(day.waterRecs, record => ({ ml: number(record.amount), time: time(record) })) };
    if (selected.includes("meal") && day.mealRecs?.length) result.meal = { ...logList(day.mealRecs, record => ({ type: text(record.mealType), name: text(record.name), note: text(record.note), time: time(record), nutrition: mealNutrition(record) })), nutrition: nutritionSummary(day.mealRecs) };
    if (selected.includes("workout") && (day.isWorkout || Object.keys(day.workoutDetail || {}).length)) {
      const detail = day.workoutDetail || {};
      result.workout = { markedWorkoutDay: !!day.isWorkout, activity: text(detail.activity), durationMinutes: number(detail.duration), focus: text(detail.focus), intensity: text(detail.intensity), note: text(detail.note) };
    }
    for (const [category, source] of [["medicine", "medRecs"], ["supplement", "suppRecs"]]) {
      if (selected.includes(category) && day[source]?.length) result[category] = logList(day[source], record => ({ name: text(record.name), dosage: text(record.dosage), count: number(record.count ?? (record.taken ? 1 : 0)), time: time(record) }));
    }
    if (selected.includes("toilet") && day.toiletRecs?.length) result.toilet = logList(day.toiletRecs, record => ({ type: text(record.type), time: time(record) }));
    return result;
  }).filter(day => Object.keys(day).length > 1);
  const context = { snapshot: { generatedAt: now.toISOString(), localDate: toDateKey(now), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, range, categories: selected, units: { water: "ml", height: "cm", weight: "kg", bodyFat: "%", duration: "minutes", energy: "kcal", carbs: "g", protein: "g", fat: "g" }, note: "本轮提问读取的记录快照，更新同日数值时以本轮为准，不能沿用旧回答中的数据。仅包含用户选择的已记录数据。缺失日期或类别不表示零摄入、未服用或未训练；今天的记录可能尚未完成。entries 有上限时 omitted 为省略数量。营养总量仅合计有营养数值的条目，missing 是未记录营养的条目数；estimatedEntries 是估算条目数，不等于精确测量。", days: snapshots };
  if (selected.includes("meal")) {
    context.todayNutrition = { date: toDateKey(now), ...nutritionSummary(selectedDays.filter(day => day.dateKey === toDateKey(now)).flatMap(day => day.mealRecs || [])) };
    context.dailyNutritionTargetsG = nutritionTargets(profile?.nutritionGoal);
    const daily = dailyNutritionGoals(profile?.nutritionGoal);
    context.dailyNutrientGoals = { fiberG: { value: daily.fiberG, unit: "g", kind: "minimum" }, sodiumMg: { value: daily.sodiumMg, unit: "mg", kind: "limit" }, source: profile?.nutritionGoal?.daily ? "saved" : "default" };
    context.units.nutrients = Object.fromEntries(FOOD_NUTRIENTS.map(field => [field.key, field.unit]));
    context.note += " 五项补充营养允许null，代表未知，不是0。nutrientCoverage是各补充指标有数值的条目数，仅合计已知条目；不足entries时不能当作完整日摄入。钠单位mg，糖和膳食纤维等单位g。";
    const columns = ["name", "aliases", "servingAmount", "servingUnit", ...FOOD_NUTRIENTS.map(field => field.key), "note"];
    const foods = normalizeFoodCatalog(profile?.foodCatalog);
    context.foodCatalog = { count: foods.length, entries: foods.map(food => Object.fromEntries(columns.map(key => [key, food[key]]))),
      note: "用户当前保存的常吃食物营养参考，不是已食用记录，不受历史日期范围限制。每项数值对应 servingAmount 和 servingUnit；能量为 kcal，三大营养素为 g。若使用 columns/rows 表格，按列名读取行值，所有食物及其份量、营养、别名、备注均完整保留。" };

  }
  const selectedMeasurements = measurements.filter(item => inHistoryRange(item.date, range));
  if (selected.includes("body")) {
    context.bodyMeasurements = selectedMeasurements.slice(0, compact ? selectedMeasurements.length : 60).map(item => ({ date: item.date, height: item.height ?? null, weight: item.weight ?? null, bodyFat: item.bodyFat ?? null }));
    context.bodyMeasurementsOmitted = compact ? 0 : Math.max(0, selectedMeasurements.length - 60);
  }
  if (compact) {
    // A table removes repeated field names without dropping any saved food.
    // References must survive history compression, including older/all ranges.
    if (JSON.stringify(context).length > 18000 && context.foodCatalog?.count) {
      const columns = Object.keys(context.foodCatalog.entries[0]);
      const rows = context.foodCatalog.entries.map(food => columns.map(key => food[key]));
      const { entries, ...metadata } = context.foodCatalog;
      context.foodCatalog = { ...metadata, columns, rows };
    }
    if (Number.isFinite(profile?.dailyGoal)) context.dailyWaterGoalMl = profile.dailyGoal;
    // Detailed records are preferred. For large histories, every recorded date
    // contributes to the summary; no older date/category is silently dropped.
    if (JSON.stringify(context).length > 18000 || snapshots.some(day => Object.values(day).some(value => value?.omitted > 0))) {
      context.days = selectedDays.map(day => summarizeDays([day], selected, day.dateKey));
      context.summarized = "daily";
    }
    if (JSON.stringify(context).length > 18000) {
      const months = new Map();
      for (const day of selectedDays) { const month = day.dateKey.slice(0, 7); if (!months.has(month)) months.set(month, []); months.get(month).push(day); }
      context.days = [...months].sort(([a], [b]) => b.localeCompare(a)).map(([month, records]) => summarizeDays(records, selected, month));
      context.summarized = "monthly";
    }
    if (JSON.stringify(context).length > 18000 && selected.includes("body")) {
      context.bodyMeasurements = summarizeMeasurements(selectedMeasurements);
      context.summarized = `${context.summarized || "records"}+body-monthly`;
    }
    if (JSON.stringify(context).length > 18000) {
      context.days = selectedDays.length ? [summarizeDays(selectedDays, selected, "all-recorded-dates")] : [];
      context.summarized = "whole-period";
    }
    if (context.summarized) context.note += " 数据量较大，已使用统计摘要；所有已读取日期都计入统计，个别名称、备注和时间等原始明细不在摘要中，不能依据摘要臆测这些明细。recordedDays 是有记录的日期数，不是每天都完成。";
  }
  if (JSON.stringify(context).length > 18000) throw new Error("所选记录较多，请缩短时间范围或减少记录类别");
  return context;
}

function summarizeDays(days, selected, period) {
  const result = { period, recordedDays: days.length, startDate: days.map(day => day.dateKey).sort()[0], endDate: days.map(day => day.dateKey).sort().at(-1) };
  if (selected.includes("water")) {
    const recorded = days.filter(day => day.waterRecs?.length), records = recorded.flatMap(day => day.waterRecs);
    if (records.length) result.water = { recordedDays: recorded.length, count: records.length, totalMl: records.reduce((sum, record) => sum + (number(record.amount) || 0), 0) };
  }
  if (selected.includes("meal")) {
    const records = days.flatMap(day => day.mealRecs || []);
    const meals = new Map();
    for (const day of days) for (const record of day.mealRecs || []) {
      const type = ["breakfast", "lunch", "dinner", "snack"].includes(record.mealType) ? record.mealType : "other";
      meals.set(`${day.dateKey}:${type}`, type);
    }
    if (records.length) result.meal = { entries: records.length, mealsRecorded: meals.size, byType: [...meals.values()].reduce((types, type) => { types[type] = (types[type] || 0) + 1; return types; }, {}), nutrition: nutritionSummary(records) };
  }
  if (selected.includes("workout")) {
    const records = days.filter(day => day.isWorkout || Object.keys(day.workoutDetail || {}).length);
    if (records.length) result.workout = { recordedDays: records.length, markedWorkoutDays: records.filter(day => day.isWorkout).length, knownDurationMinutes: records.reduce((sum, day) => sum + (number(day.workoutDetail?.duration) || 0), 0), durationRecordedDays: records.filter(day => day.workoutDetail?.duration != null && number(day.workoutDetail.duration) != null).length };
  }
  for (const [category, source] of [["medicine", "medRecs"], ["supplement", "suppRecs"]]) {
    if (!selected.includes(category)) continue;
    const records = days.flatMap(day => day[source] || []), groups = new Map();
    for (const record of records) {
      const name = text(record.name), dosage = text(record.dosage), key = JSON.stringify([name, dosage]);
      if (!groups.has(key)) groups.set(key, { name, recordedDosage: dosage, entries: 0, recordedCount: 0 });
      const entry = groups.get(key); entry.entries++; entry.recordedCount += number(record.count ?? (record.taken ? 1 : 0)) || 0;
    }
    if (records.length) result[category] = { count: records.length, names: [...groups.values()].slice(0, 20), omittedNames: Math.max(0, groups.size - 20) };
  }
  if (selected.includes("toilet")) {
    const records = days.flatMap(day => day.toiletRecs || []);
    if (records.length) result.toilet = { count: records.length, small: records.filter(record => record.type === "small").length, big: records.filter(record => record.type === "big").length, other: records.filter(record => !["small", "big"].includes(record.type)).length };
  }
  return result;
}

function summarizeMeasurements(records) {
  const groups = new Map();
  for (const record of records) { const month = record.date.slice(0, 7); if (!groups.has(month)) groups.set(month, []); groups.get(month).push(record); }
  return [...groups].map(([month, items]) => {
    const result = { month, recordedCount: items.length };
    for (const metric of ["height", "weight", "bodyFat"]) {
      const measured = items.filter(item => Number.isFinite(item[metric])).sort((a, b) => a.date.localeCompare(b.date));
      if (measured.length) result[metric] = { first: { date: measured[0].date, value: measured[0][metric] }, last: { date: measured.at(-1).date, value: measured.at(-1)[metric] }, min: Math.min(...measured.map(item => item[metric])), max: Math.max(...measured.map(item => item[metric])) };
    }
    return result;
  });
}
