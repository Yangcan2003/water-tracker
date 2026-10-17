// Synthetic history only: forty cloud days but just three local days.
import { storage } from "../js/storage.js";
import { toDateKey } from "../js/utils.js";
import { mock } from "./firebase-mock.mjs";

export function seedHistoryFixture() {
  mock.failMealOnce = false;
  const data = storage._emptyData();
  for (let offset = 0; offset < 40; offset++) {
    const date = new Date(); date.setDate(date.getDate() - offset);
    const dateKey = toDateKey(date);
    const id = `fixture-${offset}`;
    date.setHours(8, 20, 0, 0);
    const record = { id, source: "我的水杯", amount: 550, logDate: dateKey, recordedAt: date };
    mock.documents.set(`users/sync-test/waterLogs/${id}`, record);
    for (const [suffix, hour, amount] of [["noon", 11, 650], ["afternoon", 14, 650 + offset % 4 * 100]]) {
      const time = new Date(date); time.setHours(hour, 10);
      mock.documents.set(`users/sync-test/waterLogs/${id}-${suffix}`, { source: "饮用水", amount, logDate: dateKey, recordedAt: time });
    }
    for (const [mealType, hour, name] of [["breakfast", 8, "燕麦、鸡蛋"], ["lunch", 12, "米饭、鸡胸肉"], ["dinner", 18, "蔬菜沙拉"]]) {
      if (offset === 0 && mealType === "dinner") continue;
      const time = new Date(date); time.setHours(hour, 30);
      mock.documents.set(`users/sync-test/mealLogs/${id}-${mealType}`, { mealType, name, logDate: dateKey, recordedAt: time });
    }
    mock.documents.set(`users/sync-test/medicineLogs/${id}`, { name: "EVA", dosage: "1粒/次", count: 2, logDate: dateKey, recordedAt: new Date(date) });
    for (const [index, name] of ["维生素C", "鱼油", "镁"].entries()) {
      mock.documents.set(`users/sync-test/supplementLogs/${id}-${index}`, { name, count: 1, dosage: "1粒/次", logDate: dateKey, recordedAt: new Date(date) });
    }
    if (offset % 3 === 0) mock.documents.set(`users/sync-test/workoutLogs/${dateKey}`, { isWorkout: true, activity: "力量训练", focus: "上肢训练", intensity: "适中", duration: 45 });
    for (let index = 0; index < 3; index++) {
      const time = new Date(date); time.setHours(8 + index * 2, 45);
      mock.documents.set(`users/sync-test/toiletLogs/${id}-${index}`, { type: index === 0 ? "big" : "small", logDate: dateKey, recordedAt: time });
    }
    if (offset < 3) data.records[dateKey] = {
      water: [{ ...record, recordedAt: date.toISOString() }], medicine: [], supplement: [], toilet: [], meal: [],
    };
  }
  storage._saveLocal(data);
  const fetchHistory = storage._fetchAllHistory.bind(storage);
  storage._fetchAllHistory = async range => {
    const days = await fetchHistory(range);
    await new Promise(resolve => setTimeout(resolve, 1500));
    return days;
  };
  const counts = [];
  new MutationObserver(() => {
    const count = document.querySelectorAll("#historyPageContent .history-day-card").length;
    if (counts.at(-1) !== count) counts.push(count);
    document.documentElement.dataset.historyCounts = counts.join(",");
  }).observe(document.body, { childList: true, subtree: true });
}
