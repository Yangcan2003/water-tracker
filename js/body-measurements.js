import { fromDateKey, toDateKey } from "./utils.js";

export const BODY_METRICS = [
  { key: "height", label: "身高", unit: "cm", min: 1, max: 300 },
  { key: "weight", label: "体重", unit: "kg", min: 0.1, max: 1000 },
  { key: "bodyFat", label: "体脂率", unit: "%", min: 0.1, max: 100 },
];

export function validateMeasurement(input, today = toDateKey(new Date())) {
  const date = String(input.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(fromDateKey(date)) !== date || date > today) {
    throw new Error("请选择有效的测量日期，不能晚于今天");
  }
  const record = { date };
  for (const metric of BODY_METRICS) {
    const raw = input[metric.key];
    if (raw == null || String(raw).trim() === "") { record[metric.key] = null; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < metric.min || value > metric.max || Math.abs(value * 10 - Math.round(value * 10)) > 0.000001) {
      throw new Error(`${metric.label}请输入 ${metric.min}–${metric.max} ${metric.unit}，最多一位小数`);
    }
    record[metric.key] = value;
  }
  if (BODY_METRICS.every(metric => record[metric.key] == null)) throw new Error("请至少填写一项身体数据");
  return record;
}

// Unique entries merge independently, including explicit deletion tombstones.
export function mergeMeasurements(...maps) {
  const result = {};
  for (const map of maps) {
    for (const [id, entry] of Object.entries(map || {})) {
      if (!entry || typeof entry !== "object" || !entry.date) continue;
      const previous = result[id];
      const version = String(entry.updatedAt || entry.createdAt || "");
      const previousVersion = String(previous?.updatedAt || previous?.createdAt || "");
      if (!previous || version > previousVersion || (version === previousVersion && (entry.deleted || !previous.deleted))) {
        result[id] = { ...entry, id };
      }
    }
  }
  return result;
}

export function measurementHistory(map) {
  return Object.values(mergeMeasurements(map)).filter(entry => !entry.deleted)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id));
}

export function latestMeasurements(map) {
  const history = measurementHistory(map);
  return Object.fromEntries(BODY_METRICS.map(({ key }) => [key, history.find(entry => Number.isFinite(entry[key])) || null]));
}

export function formatMeasurement(value) {
  return Number.isFinite(value) ? String(value) : "—";
}
