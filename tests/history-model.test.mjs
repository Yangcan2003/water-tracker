import test from "node:test";
import assert from "node:assert/strict";
import {
  currentMonth, shiftHistoryMonth, historyMonthRange, historyMonthCells,
  historyDayMetrics, filterHistoryDays, historyMonthSummary, historyDayEvents, historyDayLabel,
} from "../js/history-model.js";

const now = new Date(2026, 9, 12, 14);
const day = (dateKey, extras = {}) => ({ dateKey, waterTotal: 0, waterRecs: [], mealRecs: [], medRecs: [], suppRecs: [], toiletRecs: [], isWorkout: false, workoutDetail: {}, ...extras });

test("explicit rest marks appear in history without counting as training days", () => {
  const rest = day("2026-10-16", { workoutDetail: { activity: "休息日" } });
  const training = day("2026-10-15", { isWorkout: true, workoutDetail: { activity: "练肩日" } });
  assert.equal(historyDayMetrics(rest)[0].value, "休息日");
  assert.equal(historyDayEvents(rest)[0].title, "休息日");
  assert.equal(historyDayEvents(rest)[0].detail, "");
  assert.equal(historyMonthSummary([rest, training]).workoutDays, 1);
  assert.equal(filterHistoryDays([rest, training], "workout").length, 2);
  assert.equal(historyDayEvents(training)[0].value, "已标记");
});

test("month navigation handles year changes and limits this month to today", () => {
  assert.equal(currentMonth(now), "2026-10");
  assert.equal(shiftHistoryMonth("2026-01", -1), "2025-12");
  assert.equal(shiftHistoryMonth("2025-12", 1), "2026-01");
  assert.deepEqual(historyMonthRange("2026-10", now), { startDate: "2026-10-01", endDate: "2026-10-12" });
  assert.deepEqual(historyMonthRange("2024-02", now), { startDate: "2024-02-01", endDate: "2024-02-29" });
});

test("calendar starts on Monday and marks future dates without adding false dates", () => {
  const cells = historyMonthCells("2026-10", now);
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.slice(0, 3), [null, null, null]);
  assert.equal(cells[3].dateKey, "2026-10-01");
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(cells.find(cell => cell?.day === 12).isToday, true);
  assert.equal(cells.find(cell => cell?.day === 13).isFuture, true);
  assert.equal(historyDayLabel("2026-10-12", now), "今天");
  assert.equal(historyDayLabel("2026-10-11", now), "昨天");
});

test("summary averages only recorded water days and never invents zero readings", () => {
  const data = [day("2026-10-12", { waterTotal: 1500, waterRecs: [{}] }), day("2026-10-11", { waterTotal: 2100, waterRecs: [{}], isWorkout: true }), day("2026-10-10", { medRecs: [{ count: 1 }] })];
  assert.deepEqual(historyMonthSummary(data), { recordedDays: 3, waterDays: 2, averageWater: 1800, workoutDays: 1 });
  assert.equal(historyMonthSummary([data[2]]).averageWater, null);
});

test("daily summaries count doses and meals rather than array entries or dishes", () => {
  const record = day("2026-10-12", {
    mealRecs: [{ mealType: "breakfast" }, { mealType: "breakfast" }, { mealType: "lunch" }, { mealType: "snack" }],
    medRecs: [{ count: 2 }, { taken: true }], suppRecs: [{ count: 0 }],
  });
  const metrics = historyDayMetrics(record);
  assert.equal(metrics.find(item => item.key === "meal").value, 4);
  assert.equal(metrics.find(item => item.key === "meal").unit, "条");
  assert.equal(metrics.find(item => item.key === "medicine").value, 3);
  assert.equal(metrics.find(item => item.key === "supplement").value, 0);
  assert.equal(metrics.some(item => item.key === "workout"), false);
});

test("category and date filters compose and leave the monthly data untouched", () => {
  const data = [day("2026-10-12", { waterTotal: 500 }), day("2026-10-11", { isWorkout: true })];
  assert.equal(filterHistoryDays(data, "water").length, 1);
  assert.equal(filterHistoryDays(data, "water", "2026-10-11").length, 0);
  assert.equal(filterHistoryDays(data, "all", "2026-10-11")[0], data[1]);
  assert.equal(data.length, 2);
});

test("day details order actual timestamps and keep untimed training last", () => {
  const record = day("2026-10-12", {
    waterRecs: [{ source: "水", amount: 500, recordedAt: "2026-10-12T10:00:00Z" }],
    mealRecs: [{ name: "早餐", mealType: "breakfast", recordedAt: { seconds: Date.parse("2026-10-12T08:00:00Z") / 1000 } }],
    medRecs: [{ name: "药物", count: 2, recordedAt: { toDate: () => new Date("2026-10-12T09:00:00Z") } }],
    isWorkout: true, workoutDetail: { activity: "跑步", duration: 30 },
  });
  const events = historyDayEvents(record);
  assert.deepEqual(events.map(event => event.category), ["meal", "medicine", "water", "workout"]);
  assert.equal(events[1].value, "2 次");
  assert.equal(events[3].date, null);
  assert.equal(events[3].value, "30 分钟");
});
