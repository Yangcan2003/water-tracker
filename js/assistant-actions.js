import { fromDateKey, toDateKey, toTimeValue, generateLocalId } from "./utils.js";
import { FOOD_NUTRIENTS, EXTRA_NUTRIENTS, MAX_FAVORITE_FOODS, normalizeFavoriteFood, normalizeFoodCatalog, foodServingLabel } from "./food-catalog.js";
import { normalizeMealNutrition } from "./meal-nutrition.js";
import { normalizeNutritionGoal } from "./nutrition-goals.js";
import { validateMeasurement, measurementHistory } from "./body-measurements.js";
import { ASSISTANT_VALUE_TYPES } from "./assistant-protocol.js";

export const ACTION_LABELS = { water: "饮水", meal: "饮食", medicine: "服药", supplement: "补剂", toilet: "如厕", workout: "训练", body: "身体测量", goals: "目标", food: "常吃食物" };
const nutrientKeys = FOOD_NUTRIENTS.map(field => field.key);
const sources = { water: "waterRecs", meal: "mealRecs", medicine: "medRecs", supplement: "suppRecs", toilet: "toiletRecs" };
const fields = {
  water: ["amount"], meal: ["name", "note", "mealType", "portion", ...nutrientKeys],
  food: ["name", "aliases", "note", "servingAmount", "servingUnit", ...nutrientKeys],
  medicine: ["name", "count", "dosage"], supplement: ["name", "count", "dosage"], toilet: ["type"],
  workout: ["activity", "duration", "focus", "intensity", "note"], body: ["height", "weight", "bodyFat"],
  goals: ["waterGoalMl", "goalWeightKg", "carbsRatio", "proteinRatio", "fatRatio"],
};
const finite = (value, min, max, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}数值无效`);
  return Math.round(value * 10) / 10;
};
function dateValue(value, today) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || toDateKey(fromDateKey(value)) !== value || value > today) throw new Error("记录日期无效或晚于今天");
  return value;
}
function safeText(value, label, required = false) {
  if (typeof value !== "string" || value.length > 400 || (required && !value.trim())) throw new Error(`${label}未填写或过长`);
  return value.trim();
}
export function actionRecordValues(category, record) {
  if (!record) return null;
  if (category === "goals") return { waterGoalMl: record.dailyGoal ?? 2000, goalWeightKg: record.nutritionGoal?.weightKg ?? null,
    carbsRatio: record.nutritionGoal?.ratios?.carbsG ?? null, proteinRatio: record.nutritionGoal?.ratios?.proteinG ?? null, fatRatio: record.nutritionGoal?.ratios?.fatG ?? null };
  const value = Object.fromEntries(fields[category].map(key => [key, record[key] ?? null]));
  if (category === "meal") Object.assign(value, Object.fromEntries(["portion", ...nutrientKeys].map(key => [key, record.nutrition?.[key] ?? null])));
  return value;
}
export function actionFingerprint(category, record) {
  return JSON.stringify(record ? { date: record.logDate || record.date || null, time: record.recordedAt ? toTimeValue(record.recordedAt?.toDate?.() || new Date(record.recordedAt)) : null, values: actionRecordValues(category, record), deleted: !!record.deleted } : null);
}
export function buildActionCatalog(days, measurements, profile, question = "") {
  const rows = [];
  const foodIntent = /常吃|常用|食物库/.test(question);
  for (const record of normalizeFoodCatalog(profile?.foodCatalog)) rows.push({ category: "food", date: "", record });
  for (const day of days) {
    for (const [category, source] of Object.entries(sources)) for (const record of day[source] || []) if (record.id) rows.push({ category, date: day.dateKey, record });
    if (day.isWorkout || day.workoutDetail?.activity) rows.push({ category: "workout", date: day.dateKey, record: { ...day.workoutDetail, isWorkout: day.isWorkout, logDate: day.dateKey, id: day.dateKey } });
  }
  for (const record of measurementHistory(measurements)) rows.push({ category: "body", date: record.date, record });
  const dates = new Set(question.match(/\d{4}-\d{2}-\d{2}/g) || []);
  const relevance = row => row.category === "food" ? Number(foodIntent) + Number(question.includes(row.record.name)) * 3 : Number(dates.has(row.date));
  rows.sort((a, b) => relevance(b) - relevance(a) || b.date.localeCompare(a.date));
  const references = new Map(), records = [];
  let size = 0;
  for (const row of rows) {
    const ref = `r${records.length + 1}`;
    const entry = { ref, category: row.category, date: row.date, time: row.record.recordedAt ? toTimeValue(row.record.recordedAt?.toDate?.() || new Date(row.record.recordedAt)) : null, values: actionRecordValues(row.category, row.record) };
    const length = JSON.stringify(entry).length;
    if (size + length > 16000 || records.length >= 80) continue;
    size += length; records.push(entry); references.set(ref, { ...row, fingerprint: actionFingerprint(row.category, row.record) });
  }
  if (profile) references.set("goals", { category: "goals", record: profile, fingerprint: actionFingerprint("goals", profile) });
  return { data: { localDate: toDateKey(new Date()), localTime: toTimeValue(new Date()), records, omitted: rows.length - records.length, ...(profile ? { goals: actionRecordValues("goals", profile) } : {}) }, references };
}

export function prepareAssistantAction(action, catalog, now = new Date()) {
  if (!action || !["create", "update", "delete"].includes(action.operation) || !Object.hasOwn(fields, action.category)) throw new Error("不支持这项数据操作");
  const { operation, category } = action;
  if (category === "goals" && operation !== "update") throw new Error("目标只支持修改");
  const target = operation === "create" ? null : catalog.references.get(action.ref);
  if (operation !== "create" && (!target || target.category !== category)) throw new Error("找不到唯一的目标记录，请指定日期和内容后重新提问");
  const today = toDateKey(now), date = dateValue(action.date || target?.date || today, today);
  if (target?.date && target.date !== date) throw new Error("更换记录日期请在原记录页面操作");
  const supplied = action.values;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("记录内容无效");
  for (const [key, value] of Object.entries(supplied)) if (value != null && (!fields[category].includes(key) || typeof value !== ASSISTANT_VALUE_TYPES[key])) throw new Error("记录包含不支持的字段");
  const patch = Object.fromEntries(Object.entries(supplied).filter(([, value]) => value != null));
  if (operation === "update" && !Object.keys(patch).length && !action.time) throw new Error("没有需要修改的内容");
  const previous = target?.record || null;
  if (category === "food") {
    let next = null;
    if (operation !== "delete") {
      const values = { ...actionRecordValues(category, previous), ...patch };
      if (previous && values.servingUnit === previous.servingUnit && values.servingAmount !== previous.servingAmount) {
        const ratio = values.servingAmount / previous.servingAmount;
        for (const key of nutrientKeys) if (!(key in patch) && previous[key] != null) values[key] = previous[key] * ratio;
      } else if (previous && values.servingUnit !== previous.servingUnit && nutrientKeys.some(key => previous[key] != null && !(key in patch))) {
        throw new Error("更换计量单位时，请同时确认所有已有营养数值，避免份量与营养不一致");
      }
      next = normalizeFavoriteFood({ ...values, id: previous?.id || generateLocalId() });
      if (!next) throw new Error("常吃食物需要有效的名称、计量份量及四项基础营养；补充营养未知可留空");
    }
    return { operation, category, date: null, before: previous, after: next, target, state: "pending" };
  }
  let next = null;
  if (operation !== "delete") {
    const values = { ...actionRecordValues(category, previous), ...patch };
    const time = action.time || (previous?.recordedAt ? toTimeValue(previous.recordedAt?.toDate?.() || new Date(previous.recordedAt)) : toTimeValue(now));
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("记录时间无效");
    const recordedAt = fromDateKey(date); const [hour, minute] = time.split(":").map(Number); recordedAt.setHours(hour, minute, 0, 0);
    next = { ...(previous || {}), logDate: date, recordedAt };
    if (category === "water") Object.assign(next, { amount: finite(values.amount, 1, 10000, "饮水"), source: previous?.source || "助手记录" });
    if (category === "meal") {
      if (!["breakfast", "lunch", "dinner", "snack"].includes(values.mealType)) throw new Error("请说明这是早餐、午餐、晚餐还是加餐");
      Object.assign(next, { name: safeText(values.name, "食物名称", true), note: safeText(values.note || "", "备注"), mealType: values.mealType });
      const hasNutrition = nutrientKeys.some(key => values[key] != null);
      if (hasNutrition) {
        const nutrition = normalizeMealNutrition({ ...previous?.nutrition, ...Object.fromEntries([...nutrientKeys, "portion"].map(key => [key, values[key]])), source: "ai", note: "助手提议，经用户确认保存" });
        if (!nutrition) throw new Error("营养数值不完整，请补全热量、碳水、蛋白质和脂肪后重试");
        next.nutrition = nutrition;
      } else next.nutrition = null;
      if (previous?.nutrition && ![...nutrientKeys, "portion"].some(key => patch[key] != null)) next.nutrition = previous.nutrition;
    }
    if (["medicine", "supplement"].includes(category)) Object.assign(next, { name: safeText(values.name, "名称", true), dosage: safeText(values.dosage || "", "服用记录"), count: finite(values.count, 0.1, 99, "服用数量") });
    if (category === "toilet") { if (!["small", "big"].includes(values.type)) throw new Error("请说明是小号还是大号"); next.type = values.type; }
    if (category === "workout") Object.assign(next, { activity: safeText(values.activity, "训练内容", true), duration: values.duration == null ? 0 : finite(values.duration, 0, 1440, "训练时长"), focus: safeText(values.focus || "", "训练部位"), intensity: safeText(values.intensity || "适中", "强度"), note: safeText(values.note || "", "备注"), isWorkout: values.activity !== "休息日" });
    if (category === "body") next = { ...(previous || {}), ...validateMeasurement({ date, height: values.height, weight: values.weight, bodyFat: values.bodyFat }, today) };
    if (category === "goals") {
      next = { ...previous, dailyGoal: finite(values.waterGoalMl, 100, 10000, "饮水目标") };
      if (["goalWeightKg", "carbsRatio", "proteinRatio", "fatRatio"].some(key => patch[key] != null)) {
        const goal = normalizeNutritionGoal({ weightKg: values.goalWeightKg, ratios: { carbsG: values.carbsRatio, proteinG: values.proteinRatio, fatG: values.fatRatio } });
        if (!goal) throw new Error("营养目标不完整，请明确体重及三个营养系数"); next.nutritionGoal = goal;
      }
    }
  }
  return { operation, category, date, before: previous, after: next, target, state: "pending" };
}

export function describeAssistantRecord(category, record, date) {
  if (!record) return "无";
  const v = actionRecordValues(category, record), time = record.recordedAt ? toTimeValue(record.recordedAt?.toDate?.() || new Date(record.recordedAt)) : "";
  const extras = EXTRA_NUTRIENTS.filter(field => v[field.key] != null).map(field => `${field.label} ${v[field.key]} ${field.unit}`).join(" / ");
  if (category === "food") return `${v.name}${v.aliases ? `（${v.aliases}）` : ""} · ${foodServingLabel(v)} · ${v.kcal} kcal / 碳水 ${v.carbsG} g / 蛋白质 ${v.proteinG} g / 脂肪 ${v.fatG} g${extras ? ` · ${extras}` : ""}${v.note ? ` · ${v.note}` : ""}`;
  const descriptions = {
    water: `${v.amount} ml`, meal: `${({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" })[v.mealType] || "饮食"} · ${v.name}${v.portion ? ` · ${v.portion}` : ""}${v.kcal != null ? ` · ${v.kcal} kcal / 碳水 ${v.carbsG} g / 蛋白质 ${v.proteinG} g / 脂肪 ${v.fatG} g` : ""}${v.note ? ` · ${v.note}` : ""}`,
    medicine: `${v.name} · ${v.count} 次/份 · ${v.dosage || ""}`, supplement: `${v.name} · ${v.count} 次/份 · ${v.dosage || ""}`,
    toilet: v.type === "big" ? "大号" : "小号", workout: `${v.activity} · ${v.duration || 0} 分钟 · ${v.focus || ""} · ${v.intensity || ""} · ${v.note || ""}`,
    body: [v.height != null ? `身高 ${v.height} cm` : "", v.weight != null ? `体重 ${v.weight} kg` : "", v.bodyFat != null ? `体脂 ${v.bodyFat}%` : ""].filter(Boolean).join(" · "),
    goals: `饮水 ${v.waterGoalMl} ml${v.goalWeightKg != null ? ` · 体重 ${v.goalWeightKg} kg · 碳水/蛋白质/脂肪系数 ${v.carbsRatio}/${v.proteinRatio}/${v.fatRatio} g/kg` : ""}`,
  };
  return [category === "goals" ? "" : date, time, descriptions[category], category === "meal" ? extras : ""].filter(Boolean).join(" · ");
}

async function readCurrent(storage, change) {
  const { category, date, target } = change;
  if (category === "goals") return storage.getProfile({ force: true });
  if (category === "body") { await storage.getProfile({ force: true }); const value = storage.getCachedBodyMeasurements()[target.record.id]; return value && !value.deleted ? value : null; }
  if (category === "workout") {
    const record = await storage.getWorkoutDetail(date), marked = await storage.getWorkoutDay(date);
    return record?.activity || marked ? { ...record, isWorkout: marked, logDate: date, id: date } : null;
  }
  const rows = category === "water" ? await storage.getWaterLogs(date) : await storage.getLogs(category, date);
  return rows.find(record => record.id === target.record.id) || null;
}
export async function executeAssistantAction(storage, change, { uid, getUser }) {
  const guard = () => { if (getUser()?.uid !== uid || storage.currentUser?.uid !== uid) throw new Error("账号已切换，请重新提问"); };
  guard();
  if (change.state !== "pending") throw new Error("这项操作已处理，请勿重复执行");
  change.state = "applying";
  try {
  if (change.category === "food") {
    const profile = await storage.getProfile({ force: true }); guard();
    if (storage.syncStatus.failures.some(item => item.kind === "read")) throw new Error("无法核对最新食物库，请联网后重试");
    const foods = normalizeFoodCatalog(profile.foodCatalog), index = foods.findIndex(food => food.id === change.target?.record.id);
    if (change.target && (index < 0 || actionFingerprint("food", foods[index]) !== change.target.fingerprint)) throw new Error("这项常吃食物已经发生变化，请重新提问后再确认");
    if (change.operation === "create" && foods.length >= MAX_FAVORITE_FOODS) throw new Error("最多保存 50 种常吃食物，请先整理食物库");
    const duplicate = food => food.name.replace(/\s/g, "").toLocaleLowerCase();
    if (change.after && foods.some(food => food.id !== change.after.id && duplicate(food) === duplicate(change.after) && food.servingUnit === change.after.servingUnit && food.servingAmount === change.after.servingAmount)) throw new Error("已存在同名同份量的食物，请明确修改已有项");
    if (change.operation === "delete") foods.splice(index, 1);
    else if (index >= 0) foods[index] = change.after;
    else foods.push(change.after);
    guard(); await storage.updateProfile({ foodCatalog: foods }); change.state = "applied"; guard();
    return change.after || change.before;
  }
  let current = null;
  if (change.target) {
    current = await readCurrent(storage, change); guard();
    if (storage.syncStatus.failures.some(item => item.kind === "read")) throw new Error("无法核对最新记录，请联网后重试");
    if (!current || actionFingerprint(change.category, current) !== change.target.fingerprint) throw new Error("这条记录已经发生变化，请重新提问后再确认");
  } else if (change.category === "workout") {
    const detail = await storage.getWorkoutDetail(change.date); guard();
    if (detail?.activity) throw new Error("这天已有训练记录，请明确修改而不是新增");
  }
  guard();
  const record = change.operation === "delete" ? current : { ...(current || {}), ...change.after };
  // Restore photos from the fresh record; catalog/history never sends them.
  if (change.category === "meal" && current) record.photos = current.photos;
  const saved = await storage.writeAssistantRecord(change.category, change.date, record, change.operation === "delete", current?.id);
  change.state = "applied"; guard();
  return saved;
  } catch (error) { if (change.state !== "applied") change.state = "pending"; throw error; }
}
