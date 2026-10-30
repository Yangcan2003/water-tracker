import { toDateKey, fromDateKey } from "./utils.js";

export const HISTORY_CATEGORIES = [
  { key: "all", label: "全部" },
  { key: "water", label: "饮水" },
  { key: "meal", label: "饮食" },
  { key: "workout", label: "训练" },
  { key: "medicine", label: "用药" },
  { key: "supplement", label: "补剂" },
  { key: "toilet", label: "如厕" },
];

export function currentMonth(now = new Date()) { return toDateKey(now).slice(0, 7); }

export function shiftHistoryMonth(month, offset) {
  const [year, index] = month.split("-").map(Number);
  return currentMonth(new Date(year, index - 1 + offset, 1));
}

export function historyMonthRange(month, now = new Date()) {
  const [year, index] = month.split("-").map(Number);
  const last = toDateKey(new Date(year, index, 0));
  const today = toDateKey(now);
  return { startDate: `${month}-01`, endDate: last > today ? today : last };
}

export function historyMonthCells(month, now = new Date()) {
  const [year, index] = month.split("-").map(Number);
  const today = toDateKey(now);
  const offset = (new Date(year, index - 1, 1).getDay() + 6) % 7;
  const cells = Array(offset).fill(null);
  for (let day = 1; day <= new Date(year, index, 0).getDate(); day++) {
    const dateKey = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ dateKey, day, isToday: dateKey === today, isFuture: dateKey > today });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

const countDoses = records => records.reduce((sum, record) => sum + Math.max(0, Number(record.count ?? (record.taken ? 1 : 0)) || 0), 0);

export function historyDayMetrics(day) {
  const metrics = [];
  const add = (key, value, unit, note = "") => metrics.push({ key, value, unit, note, label: HISTORY_CATEGORIES.find(item => item.key === key).label });
  if (day.waterRecs?.length || day.waterTotal > 0) add("water", Math.round(Number(day.waterTotal) || 0), "ml");
  if (day.mealRecs?.length) {
    add("meal", day.mealRecs.length, "条");
  }
  if (day.isWorkout || day.workoutDetail?.activity === "休息日") add("workout", day.workoutDetail?.activity || "已训练", "", day.workoutDetail?.duration > 0 ? `${day.workoutDetail.duration} 分钟` : "");
  if (day.medRecs?.length) add("medicine", countDoses(day.medRecs), "次");
  if (day.suppRecs?.length) add("supplement", countDoses(day.suppRecs), "次");
  if (day.toiletRecs?.length) add("toilet", day.toiletRecs.length, "次");
  return metrics;
}

export function filterHistoryDays(days, category = "all", dateKey = null) {
  return days.filter(day => (!dateKey || day.dateKey === dateKey) && (category === "all" || historyDayMetrics(day).some(metric => metric.key === category)));
}

export function historyMonthSummary(days) {
  const waterDays = days.filter(day => day.waterRecs?.length || day.waterTotal > 0);
  return {
    recordedDays: days.length,
    waterDays: waterDays.length,
    averageWater: waterDays.length ? Math.round(waterDays.reduce((sum, day) => sum + (Number(day.waterTotal) || 0), 0) / waterDays.length) : null,
    workoutDays: days.filter(day => day.isWorkout).length,
  };
}

export function historyDayLabel(dateKey, now = new Date()) {
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === toDateKey(now)) return "今天";
  if (dateKey === toDateKey(yesterday)) return "昨天";
  return fromDateKey(dateKey).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function eventDate(value) {
  if (!value) return null;
  const date = value.toDate?.() ?? new Date(typeof value.seconds === "number" ? value.seconds * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function historyDayEvents(day) {
  const events = [];
  const add = (category, record, title, value, detail = "") => events.push({ category, id: record.id || (category === "workout" ? day.dateKey : ""), title, value, detail, date: eventDate(record.recordedAt) });
  for (const record of day.waterRecs || []) add("water", record, record.source || "饮水", `${Number(record.amount) || 0} ml`);
  for (const record of day.mealRecs || []) add("meal", record, record.name || "饮食", "饮食记录", record.note || "");
  for (const [category, records] of [["medicine", day.medRecs], ["supplement", day.suppRecs]]) {
    for (const record of records || []) {
      const count = countDoses([record]);
      add(category, record, record.name || (category === "medicine" ? "用药" : "补剂"), count ? `${count} 次` : "未服用", record.dosage || "");
    }
  }
  for (const record of day.toiletRecs || []) add("toilet", record, record.type === "big" ? "大号" : "小号", "如厕");
  if (day.isWorkout || day.workoutDetail?.activity === "休息日") {
    const detail = day.workoutDetail || {};
    add("workout", detail, detail.activity || "训练", detail.duration > 0 ? `${detail.duration} 分钟` : "已标记", [detail.focus, detail.intensity, detail.note].filter(Boolean).join(" · "));
  }
  return events.sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
}
