import { mock } from "./firebase-mock.mjs";
import { LS_KEY, DEFAULT_MEDICINES, DEFAULT_SUPPLEMENTS } from "../js/config.js";
import { toDateKey } from "../js/utils.js";

// Synthetic records only. No real Firebase services or health data are accessed.
export function seedStartupFixture() {
  const date = toDateKey(new Date());
  const water = { id: "cached-water", source: "测试水杯", amount: 490, logDate: date, recordedAt: new Date().toISOString() };
  const medicine = { id: "cached-medicine", name: "EVA", dosage: "1粒/次", count: 1, targetCount: 2, logDate: date, recordedAt: new Date().toISOString() };
  if (!localStorage.getItem(LS_KEY)) localStorage.setItem(LS_KEY, JSON.stringify({
    profile: { dailyGoal: 2000, medicines: DEFAULT_MEDICINES, supplements: DEFAULT_SUPPLEMENTS },
    records: { [date]: { water: [water], medicine: [medicine], supplement: [], toilet: [], meal: [] } },
    workoutDays: {}, workoutDetails: {}, meta: {}, pendingUpload: { [`${date}/water`]: true },
  }));
  mock.documents.set("users/sync-test", { dailyGoal: 2000, medicines: DEFAULT_MEDICINES, supplements: DEFAULT_SUPPLEMENTS });
  mock.documents.set("users/sync-test/waterLogs/cached-water", { ...water, recordedAt: new Date(water.recordedAt) });
  mock.documents.set("users/sync-test/medicineLogs/cached-medicine", { ...medicine, recordedAt: new Date(medicine.recordedAt) });
}
