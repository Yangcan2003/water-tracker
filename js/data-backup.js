import { fromDateKey, toDateKey } from "./utils.js";
import { normalizeMealNutrition } from "./meal-nutrition.js";
import { isMealPhoto, MAX_MEAL_PHOTOS } from "./meals.js";
import { normalizeNutritionGoal } from "./nutrition-goals.js";
import { normalizeFoodCatalog } from "./food-catalog.js";
import { normalizeFridgeInventory } from "./fridge.js";
import { validateMeasurement } from "./body-measurements.js";
import { normalizePlans, SCHEDULE_LABELS, validPlanID } from "./supplement-plan.js";
import { validWaterAmount } from "./water-values.js";

export const BACKUP_TYPES = ["water", "medicine", "supplement", "toilet", "meal"];
export const HISTORY_FIELDS = { water: "waterRecs", medicine: "medRecs", supplement: "suppRecs", toilet: "toiletRecs", meal: "mealRecs" };
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const object = value => value && typeof value === "object" && !Array.isArray(value);
const fail = () => { throw new Error("备份内容无效或不完整，请选择本 App 导出的 JSON 备份"); };
const safeID = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !["__proto__", "constructor", "prototype"].includes(value) && !value.includes("/");
const text = (value, max = 400) => { if (typeof value !== "string" || value.length > max) fail(); return value; };
export function backupDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || toDateKey(fromDateKey(value)) !== value || value > toDateKey(new Date())) fail();
  return value;
}
export function recordISO(value) {
  const date = value?.toDate?.() || new Date(typeof value?.seconds === "number" ? value.seconds * 1000 : value);
  if (!Number.isFinite(date.getTime())) fail();
  return date.toISOString();
}
function number(value, min, max) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(); return value; }
function record(type, row, date) {
  if (!object(row) || !safeID(row.id)) fail();
  const result = { id: row.id, logDate: date, recordedAt: recordISO(row.recordedAt) };
  if (toDateKey(new Date(result.recordedAt)) !== date) {
    // Legacy backfilled logs can have a different timestamp day. Preserve the
    // stored logDate rather than moving them during a round trip.
    result.logDate = date;
  }
  if (type === "water") Object.assign(result, { source: text(row.source || "饮水", 150), amount: number(row.amount, 1, 10000) });
  if (type === "toilet") { if (!["small", "big"].includes(row.type)) fail(); result.type = row.type; }
  if (["medicine", "supplement"].includes(type)) {
    Object.assign(result, { name: text(row.name, 150), dosage: text(row.dosage || "", 150), count: number(row.count ?? (row.taken ? 1 : 0), 0, 1000) });
    if (row.targetCount != null) result.targetCount = number(row.targetCount, 1, 1000);
    if (row.planId != null) { if (!validPlanID(row.planId)) fail(); result.planId = row.planId; }
  }
  if (type === "meal") {
    const photos = row.photos || [];
    if (!Array.isArray(photos) || photos.length > MAX_MEAL_PHOTOS || !photos.every(isMealPhoto) || !row.photos && row.photoIds?.length) fail();
    const nutrition = normalizeMealNutrition(row.nutrition);
    if (row.nutrition && !nutrition) fail();
    Object.assign(result, { name: text(row.name || ""), note: text(row.note || "", 2000), mealType: text(row.mealType || "meal", 40), photos: [...photos], nutrition });
    if (!result.name.trim() && !result.note.trim() && !photos.length) fail();
  }
  return result;
}
function singleLegacyScope(value) {
  const scopes = Object.values(value || {}).filter(scope => object(scope) && Object.keys(scope).length);
  if (scopes.length > 1) throw new Error("旧备份包含多个账户的身体或冰箱数据，请使用新版单账户备份");
  return scopes[0] || {};
}
export function parseBackup(input) {
  let root;
  try { root = typeof input === "string" ? JSON.parse(input) : input; } catch { fail(); }
  const modern = root?.format === "health-tracker-backup";
  if (modern && root.version !== 2) throw new Error("暂不支持这个备份版本，请更新 App 后重试");
  const raw = modern ? root.data : root;
  if (!object(raw) || !object(raw.records) || !object(raw.profile)) fail();
  const data = { records: {}, profile: {}, workoutDays: {}, workoutDetails: {}, bodyMeasurements: {}, fridgeInventory: {}, cups: [] };
  const seen = Object.fromEntries(BACKUP_TYPES.map(type => [type, new Set()]));
  for (const [date, day] of Object.entries(raw.records)) {
    backupDate(date); if (!object(day)) fail();
    data.records[date] = {};
    for (const type of BACKUP_TYPES) {
      const rows = day[type] || []; if (!Array.isArray(rows)) fail();
      data.records[date][type] = rows.map(row => { const normalized = record(type, row, date); if (seen[type].has(row.id)) fail(); seen[type].add(row.id); return normalized; });
    }
  }
  for (const date of new Set([...Object.keys(raw.workoutDays || {}), ...Object.keys(raw.workoutDetails || {})])) {
    backupDate(date);
    const detail = raw.workoutDetails?.[date] || {}, isWorkout = raw.workoutDays?.[date] === true;
    if (!isWorkout && detail.activity !== "休息日") continue;
    data.workoutDays[date] = isWorkout;
    data.workoutDetails[date] = { activity: text(detail.activity || "训练日", 80) };
    for (const field of ["focus", "intensity", "note"]) if (detail[field] != null) data.workoutDetails[date][field] = text(detail[field]);
    if (detail.duration != null && detail.duration !== "") data.workoutDetails[date].duration = number(Number(detail.duration), 0, 1440);
  }
  const body = modern ? raw.bodyMeasurements : singleLegacyScope(raw.bodyMeasurements);
  for (const [id, entry] of Object.entries(body || {})) {
    if (entry.deleted) continue;
    if (!safeID(id)) fail();
    data.bodyMeasurements[id] = { ...validateMeasurement(entry), id, createdAt: recordISO(entry.createdAt || entry.updatedAt || new Date()), updatedAt: recordISO(entry.updatedAt || entry.createdAt || new Date()) };
  }
  const fridge = modern ? raw.fridgeInventory : singleLegacyScope(raw.fridgeInventories);
  if (Object.keys(fridge || {}).some(id => !safeID(id))) fail();
  data.fridgeInventory = normalizeFridgeInventory(fridge);
  if (Object.keys(fridge || {}).length !== Object.keys(data.fridgeInventory).length) fail();
  const profile = raw.profile;
  if (profile.dailyGoal != null) data.profile.dailyGoal = number(profile.dailyGoal, 500, 10000);
  if (profile.nutritionGoal != null) { data.profile.nutritionGoal = normalizeNutritionGoal(profile.nutritionGoal); if (!data.profile.nutritionGoal) fail(); }
  for (const [key, type] of [["medicines", "medicine"], ["supplements", "supplement"]]) {
    if (profile[key] == null) continue;
    if (!Array.isArray(profile[key]) || profile[key].length > 200) fail();
    data.profile[key] = normalizePlans(profile[key].map(plan => {
      if (!object(plan)) fail();
      const item = { name: text(plan.name, 100), dosage: text(plan.dosage || "", 150), targetCount: number(plan.targetCount ?? 1, 1, 1000), schedule: plan.schedule || "everyday", enabled: plan.enabled !== false };
      if (!item.name.trim() || !Object.hasOwn(SCHEDULE_LABELS, item.schedule)) fail();
      if (plan.id) { if (!validPlanID(plan.id)) fail(); item.id = plan.id; }
      if (plan.legacyNames) { if (!Array.isArray(plan.legacyNames)) fail(); item.legacyNames = plan.legacyNames.map(name => text(name, 100)); }
      return item;
    }), type);
  }
  if (profile.foodCatalog != null) { data.profile.foodCatalog = normalizeFoodCatalog(profile.foodCatalog); if (!Array.isArray(profile.foodCatalog) || data.profile.foodCatalog.length !== profile.foodCatalog.length) fail(); }
  if (profile.avatarType != null) {
    if (!["default", "custom"].includes(profile.avatarType)) fail();
    data.profile.avatarType = profile.avatarType;
    if (profile.avatarUrl) { if (!isMealPhoto(profile.avatarUrl)) fail(); data.profile.avatarUrl = profile.avatarUrl; }
    else data.profile.avatarUrl = "";
    if (profile.avatarColor != null) { if (!/^#[0-9a-f]{6}$/i.test(profile.avatarColor)) fail(); data.profile.avatarColor = profile.avatarColor; }
  }
  if (raw.settings) {
    data.settings = {};
    for (const key of ["soundEnabled", "vibrationEnabled"]) if (typeof raw.settings[key] === "boolean") data.settings[key] = raw.settings[key];
    if (["zh", "en"].includes(raw.settings.language)) data.settings.language = raw.settings.language;
  }
  if (raw.reminder) {
    if (!Array.isArray(raw.reminder.times) || !raw.reminder.times.length || raw.reminder.times.length > 60 || raw.reminder.times.some(time => typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) fail();
    data.reminder = { enabled: raw.reminder.enabled === true, times: [...new Set(raw.reminder.times)].sort() };
  }
  if (raw.cups != null) {
    if (!Array.isArray(raw.cups) || raw.cups.some(cup => !object(cup) || !validWaterAmount(cup.amount) || !cup.name?.trim())) fail();
    data.cups = raw.cups.map(cup => ({ name: text(cup.name, 100), amount: cup.amount }));
  }
  return { format: "health-tracker-backup", version: 2, exportedAt: root.exportedAt || null, data };
}

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
};
function fingerprint(row) { const { id, createdAt, updatedAt, ...values } = row; return JSON.stringify(stable(values)); }
export function planBackupRestore(existing, incoming) {
  const additions = { records: {}, workoutDays: {}, workoutDetails: {}, bodyMeasurements: {}, fridgeInventory: {} };
  const counts = { added: 0, duplicates: 0, conflicts: 0, days: Object.keys(incoming.records).length };
  const choose = (rows, candidates, accept) => {
    const ids = new Map(rows.map(row => [row.id, row]));
    const contents = new Set(rows.map(fingerprint));
    for (const row of candidates) {
      const previous = ids.get(row.id), signature = fingerprint(row);
      if (contents.has(signature)) counts.duplicates++;
      else if (previous) counts.conflicts++;
      else { accept(row); counts.added++; contents.add(signature); ids.set(row.id, row); }
    }
  };
  for (const [date, day] of Object.entries(incoming.records)) for (const type of BACKUP_TYPES) {
    const existingRows = Object.values(existing.records).flatMap(day => day[type] || []);
    choose(existingRows, day[type] || [], row => { additions.records[date] ||= {}; (additions.records[date][type] ||= []).push(row); });
  }
  for (const [date, value] of Object.entries(incoming.workoutDays)) {
    if (Object.hasOwn(existing.workoutDays, date)) {
      if (existing.workoutDays[date] === value && JSON.stringify(stable(existing.workoutDetails[date])) === JSON.stringify(stable(incoming.workoutDetails[date]))) counts.duplicates++;
      else counts.conflicts++;
    } else { additions.workoutDays[date] = value; additions.workoutDetails[date] = incoming.workoutDetails[date]; counts.added++; }
  }
  for (const field of ["bodyMeasurements", "fridgeInventory"]) choose(Object.values(existing[field] || {}), Object.values(incoming[field] || {}).filter(row => !row.deleted), row => { additions[field][row.id] = row; });
  return { additions, counts };
}
