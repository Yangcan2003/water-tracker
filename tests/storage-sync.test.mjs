import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { normalizeFavoriteFood } from "../js/food-catalog.js";
import { historyRange } from "../js/history-range.js";
import { loadDaySnapshot } from "../js/day-loader.js";
import { buildHealthContext } from "../js/assistant-context.js";
import { accountCacheKey } from "../js/account-cache.js";
import { parseBackup } from "../js/data-backup.js";

const result = await build({
  stdin: { contents: 'export { storage } from "./js/storage.js"; export { mock } from "./tests/firebase-mock.mjs";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "mock-firebase", setup(build) {
    build.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: new URL("./firebase-mock.mjs", import.meta.url).pathname }));
  } }],
});
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const local = new Map();
globalThis.localStorage = { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
const { storage, mock } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const settleBodySync = () => new Promise(resolve => setTimeout(resolve, 0));

test("food catalog survives guest upload, cloud refresh, offline edits and explicit removal of all foods", async () => {
  const food = { id: "oats", name: "燕麦", aliases: "", note: "干重", servingAmount: 100, servingUnit: "g", kcal: 380, carbsG: 60, proteinG: 13, fatG: 7 };
  storage.setUser(null, null);
  await storage.updateProfile({ foodCatalog: [food] });
  storage.setUser({ uid: "test" }, {}); await storage.mergeLocalToCloud();
  assert.deepEqual((await storage.getProfile()).foodCatalog, [normalizeFavoriteFood(food)]);
  mock.denied.add(undefined);
  const updated = { ...food, kcal: 390 };
  await storage.updateProfile({ foodCatalog: [updated] });
  mock.denied.clear();
  assert.deepEqual((await storage.getProfile()).foodCatalog, [normalizeFavoriteFood(updated)]);
  await storage.mergeLocalToCloud();
  assert.deepEqual(mock.documents.get("users/test").foodCatalog, [normalizeFavoriteFood(updated)]);
  await storage.updateProfile({ foodCatalog: [] });
  assert.deepEqual((await storage.getProfile()).foodCatalog, []);
});

test("an upgraded client without catalog settings preserves foods already saved on another device", async () => {
  const food = { id: "egg", name: "鸡蛋", aliases: "", note: "", servingAmount: 1, servingUnit: "个", kcal: 70, carbsG: 0, proteinG: 6, fatG: 5 };
  mock.documents.set("users/test", { foodCatalog: [food] });
  const data = storage._loadLocal(); data.pendingUpload = { profile: true }; storage._saveLocal(data);
  await storage.mergeLocalToCloud();
  assert.deepEqual(mock.documents.get("users/test").foodCatalog, [food]);
  assert.deepEqual((await storage.getProfile()).foodCatalog, [normalizeFavoriteFood(food)]);
});

test("an unset goal on an upgraded device does not erase a goal saved on another device", async () => {
  const goal = { weightKg: 70, ratios: { carbsG: 3, proteinG: 1.6, fatG: 0.8 } };
  mock.documents.set("users/test", { nutritionGoal: goal });
  const data = storage._loadLocal();
  data.pendingUpload = { profile: true }; storage._saveLocal(data);
  assert.deepEqual((await storage.getProfile()).nutritionGoal, goal);
  // A device that only edited its water goal has no nutrition goal to upload.
  data.profile.nutritionGoal = null; storage._saveLocal(data);
  await storage.mergeLocalToCloud();
  assert.deepEqual(mock.documents.get("users/test").nutritionGoal, goal);
});

test("nutrition goals survive local saves, guest upload, cloud refresh and pending offline changes", async () => {
  const goal = { weightKg: 70, ratios: { carbsG: 3, proteinG: 1.6, fatG: 0.8 }, daily: { fiberG: 30, sodiumMg: 1800 } };
  storage.setUser(null, null);
  await storage.updateProfile({ nutritionGoal: goal });
  assert.deepEqual((await storage.getProfile()).nutritionGoal, goal);
  storage.setUser({ uid: "test" }, {});
  await storage.mergeLocalToCloud();
  assert.deepEqual(mock.documents.get("users/test").nutritionGoal, goal);
  assert.deepEqual((await storage.getProfile()).nutritionGoal, goal);
  mock.denied.add(undefined); // Profile path has no collection segment.
  const changed = { ...goal, weightKg: 72.5, daily: { fiberG: 28, sodiumMg: 1900 } };
  await storage.updateProfile({ nutritionGoal: changed });
  assert.deepEqual(storage.getCachedProfile().nutritionGoal, changed);
  mock.denied.clear();
  assert.deepEqual((await storage.getProfile()).nutritionGoal, changed);
  await storage.mergeLocalToCloud();
  assert.deepEqual(mock.documents.get("users/test").nutritionGoal, changed);
  assert.deepEqual((await storage.getProfile()).nutritionGoal, changed);
});
beforeEach(() => {
  const photos = new Map();
  storage.mealPhotos = {
    put: async values => values.map(value => { const id = [...photos].find(([, photo]) => photo === value)?.[0] || `photo-${photos.size}`; photos.set(id, value); return id; }),
    get: async ids => ids.map(id => photos.get(id)),
  };
  local.clear(); mock.denied.clear(); mock.writes.length = 0; mock.reads.length = 0; mock.documents.clear();
  mock.queries.length = 0;
  mock.cachedReads.clear(); mock.writeGate = null; mock.readGate = null; mock.readDelay = 0; navigator.onLine = true;
  storage.sync.timeoutMs = 12_000;
  storage.syncBatchTimeoutMs = 20_000;
  storage.setUser({ uid: "test" }, {});
});

test("account caches isolate profiles, logs and edits across sign-out, offline switches and cold restores", async () => {
  const date = "2026-10-20";
  await storage.updateProfile({ dailyGoal: 2800 });
  const water = await storage.addWaterLog({ source: "A-only", amount: 600, logDate: date, recordedAt: new Date(date + "T10:00:00") });
  await storage.saveMealRecord({ name: "A-only meal", photos: [], logDate: date, recordedAt: new Date(date + "T12:00:00") });
  await settleBodySync();
  storage.setUser(null, null);
  assert.equal(storage.getCachedDay(date).water.length, 0);
  assert.equal(storage.getCachedProfile().dailyGoal, 2000);
  storage.setUser({ uid: "B" }, {});
  assert.equal((await storage.getHistoryRange({ startDate: date, endDate: date })).length, 0);
  navigator.onLine = false;
  assert.equal(storage.getCachedDay(date).meal.length, 0);
  assert.equal(await storage.updateWaterLogTime(water.id, new Date()), false);
  assert.equal(mock.documents.has(`users/B/waterLogs/${water.id}`), false);
  storage.setUser({ uid: "test" }, null);
  assert.equal(storage.getCachedDay(date).water[0].amount, 600);
  assert.equal(storage.getCachedProfile().dailyGoal, 2800);
});

test("legacy signed-in cache is migrated only to the matching account and remains recoverable", () => {
  local.clear();
  const legacy = storage._emptyData(); legacy.profile.dailyGoal = 3100;
  localStorage.setItem("health_tracker_data", JSON.stringify(legacy));
  localStorage.setItem("watertracker:lastUser", JSON.stringify({ email: "a@example.invalid" }));
  storage.setUser({ uid: "B", email: "b@example.invalid" }, {});
  assert.equal(storage.getCachedProfile().dailyGoal, 2000);
  storage.setUser(null, null);
  assert.equal(storage.getCachedProfile().dailyGoal, 2000);
  storage.setUser({ uid: "A", email: "a@example.invalid" }, {});
  assert.equal(storage.getCachedProfile().dailyGoal, 3100);
  assert.ok(local.get("health_tracker_data"));
  assert.ok(local.get(accountCacheKey("A")));
});

test("storage exhaustion preserves unsynced old records and rejects profile and cup changes", async () => {
  storage.setUser(null, null);
  const date = "2020-01-01";
  await storage.addWaterLog({ source: "only copy", amount: 500, logDate: date, recordedAt: new Date(date + "T10:00:00") });
  const before = local.get(storage.localKey), set = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    await assert.rejects(storage.updateProfile({ dailyGoal: 3000 }), /存储空间/);
    await assert.rejects(storage.saveCups([{ name: "杯", amount: 400 }]), /存储空间/);
    assert.equal(local.get(storage.localKey), before);
    assert.equal(storage.getCachedDay(date).water.length, 1);
  } finally { localStorage.setItem = set; }
});

test("complete export includes cloud-only dates, images and current account data and rejects incomplete reads", async () => {
  const date = "2020-01-01", photo = "data:image/jpeg;base64,YQ==";
  mock.documents.set("users/test/waterLogs/remote", { source: "remote", amount: 700, logDate: date, recordedAt: new Date(date + "T10:00:00") });
  mock.documents.set("users/test/mealLogs/remote-meal", { name: "meal", photos: [photo], mealType: "meal", logDate: date, recordedAt: new Date(date + "T12:00:00") });
  const backup = await storage.createBackup();
  assert.equal(backup.data.records[date].water[0].amount, 700);
  assert.deepEqual(backup.data.records[date].meal[0].photos, [photo]);
  assert.equal(JSON.stringify(backup).includes("recordWrites"), false);
  assert.equal(parseBackup(backup).data.records[date].water[0].id, "remote");
  mock.denied.add("mealLogs");
  await assert.rejects(storage.createBackup());
  mock.denied.clear(); navigator.onLine = false;
  await assert.rejects(storage.createBackup(), /联网/);
});

test("backup restore previews duplicates and conflicts, preserves current records and is idempotent with photos", async () => {
  storage.setUser(null, null);
  const date = "2026-10-20", when = new Date(date + "T12:00:00");
  await storage.addWaterLog({ source: "杯", amount: 400, logDate: date, recordedAt: when });
  await storage.saveMealRecord({ name: "饭", photos: ["data:image/jpeg;base64,YQ=="], logDate: date, recordedAt: when });
  const backup = await storage.createBackup();
  assert.equal((await storage.previewBackupImport(backup)).duplicates, 2);
  const conflict = structuredClone(backup); conflict.data.records[date].water[0].amount = 900;
  assert.equal((await storage.previewBackupImport(conflict)).conflicts, 1);
  await storage.restoreBackup(conflict);
  assert.equal(storage.getCachedDay(date).water[0].amount, 400);
  storage.setUser({ uid: "source" }, {});
  await storage.mergeLocalToCloud();
  storage.setUser({ uid: "new" }, {});
  const restored = await storage.restoreBackup(backup);
  assert.equal(restored.added, 2);
  await settleBodySync();
  assert.equal(storage.getCachedDay(date).water[0].amount, 400);
  assert.deepEqual((await storage.getMealLogs(date))[0].photos, ["data:image/jpeg;base64,YQ=="]);
  assert.equal((await storage.restoreBackup(backup)).added, 0);
});

test("invalid water values are rejected at the durable storage boundary", async () => {
  for (const amount of [-100, 0, 9, 5001, NaN, Infinity, 10.5]) {
    await assert.rejects(storage.addWaterLog({ amount, source: "杯", logDate: "2026-10-20", recordedAt: new Date() }), /容量/);
    await assert.rejects(storage.saveCups([{ name: "杯", amount }]), /容量/);
  }
  assert.equal(storage.getCachedDay("2026-10-20").water.length, 0);
});

test("restore failures preserve the original dataset and account changes cannot land imported images in another account", async () => {
  storage.setUser(null, null);
  const date = "2026-10-20";
  const backup = { format: "health-tracker-backup", version: 2, data: { profile: {}, records: { [date]: {
    water: [{ id: "import-water", source: "杯", amount: 400, recordedAt: date + "T10:00:00" }],
    meal: [{ id: "import-meal", name: "饭", photos: ["data:image/jpeg;base64,YQ=="], recordedAt: date + "T12:00:00" }],
  } } } };
  const before = local.get(storage.localKey), set = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  try { await assert.rejects(storage.restoreBackup(backup), /存储空间/); assert.equal(local.get(storage.localKey), before); }
  finally { localStorage.setItem = set; }
  const put = storage.mealPhotos.put;
  storage.mealPhotos.put = async photos => { storage.setUser({ uid: "switched" }, {}); return put(photos); };
  await assert.rejects(storage.restoreBackup(backup), /账户已切换/);
  assert.equal(storage.getCachedDay(date).water.length, 0);
  assert.equal(storage.getCachedDay(date).meal.length, 0);
  storage.mealPhotos.put = put;
});

test("workout marks store only the chosen part and retain explicit rest across local reload and guest upload", async () => {
  storage.setUser(null, null);
  const date = "2026-10-16";
  for (const activity of ["练肩日", "练背日", "练胸日", "休息日"]) {
    await storage.saveWorkoutMark(date, activity);
    assert.deepEqual(await storage.getWorkoutDetail(date), { isWorkout: activity !== "休息日", activity });
    assert.deepEqual(storage._loadLocal().workoutDetails[date], { activity });
  }
  assert.equal((await storage.getAllHistory())[0].workoutDetail.activity, "休息日");
  assert.equal(await storage.getWorkoutDay(date), false);
  storage.setUser({ uid: "test" }, {});
  await storage.mergeLocalToCloud();
  assert.equal(mock.documents.get(`users/test/workoutLogs/${date}`).isWorkout, false);
  assert.deepEqual(await storage.getWorkoutDetail(date), { isWorkout: false, activity: "休息日" });
  assert.equal((await storage.getAllHistory())[0].workoutDetail.activity, "休息日");
  await assert.rejects(storage.saveWorkoutMark(date, "未知部位"));
});

test("rest mark replaces old workout details and survives failed writes, rapid edits and retries", async () => {
  const date = "2026-10-16";
  const path = `users/test/workoutLogs/${date}`;
  mock.documents.set(path, { isWorkout: true, activity: "练肩日", duration: 45, focus: "推肩", intensity: "适中", note: "旧记录" });
  mock.denied.add("workoutLogs");
  await storage.saveWorkoutMark(date, "练背日");
  await storage.saveWorkoutMark(date, "休息日");
  await settleBodySync();
  assert.equal(storage.getCachedDay(date).workout.isWorkout, false);
  mock.denied.clear();
  const pendingHistory = await storage.getAllHistory();
  assert.equal(pendingHistory[0].isWorkout, false);
  assert.equal(pendingHistory[0].workoutDetail.activity, "休息日");
  await storage.retryFailedRequests();
  await storage.mergeLocalToCloud();
  assert.equal(mock.documents.get(path).isWorkout, false);
  assert.equal(mock.documents.get(path).activity, "休息日");
  for (const key of ["duration", "focus", "intensity", "note"]) assert.equal(key in mock.documents.get(path), false);
  assert.deepEqual(await storage.getWorkoutDetail(date), { isWorkout: false, activity: "休息日" });
  await storage.saveWorkoutMark(date, "练胸日");
  await storage.mergeLocalToCloud();
  assert.deepEqual(await storage.getWorkoutDetail(date), { isWorkout: true, activity: "练胸日" });
  assert.equal((await storage.getAllHistory())[0].isWorkout, true);
});

test("medicine plan changes preserve logs and the original daily target across cloud reloads", async () => {
  await storage.saveItems("medicine", [{ name: "药物A", targetCount: 2 }]);
  const record = await storage.addLog("medicine", { name: "药物A", dosage: "1粒", count: 1, targetCount: 2, logDate: "2026-10-12" });
  await storage.saveItems("medicine", [{ name: "药物A", targetCount: 3, enabled: false }]);
  assert.equal((await storage.getItems("medicine"))[0].enabled, false);
  await storage.saveItems("medicine", []);
  assert.deepEqual(await storage.getItems("medicine"), []);
  const records = await storage.getLogs("medicine", "2026-10-12");
  assert.equal(records.length, 1);
  assert.equal(records[0].id, record.id);
  assert.equal(records[0].targetCount, 2);
  assert.equal(records[0].dosage, "1粒");
});

test("a failed meal read is specific, survives unrelated success, and clears after retry", async () => {
  mock.denied.add("mealLogs");
  await storage.getLogs("meal", "2026-10-11");
  await storage.getWaterLogs("2026-10-11");
  assert.equal(storage.syncStatus.state, "error");
  assert.deepEqual(storage.syncStatus.failures, [{ label: "三餐", kind: "read", code: "permission-denied" }]);
  mock.denied.clear();
  await storage.retryFailedRequests();
  assert.equal(storage.syncStatus.state, "synced");
});

test("body history survives repeated saves, backfills and serialization", async () => {
  storage.setUser(null, null);
  const first = await storage.addBodyMeasurement({ date: "2025-01-01", height: 175, weight: 68 });
  const second = await storage.addBodyMeasurement({ date: "2026-10-01", weight: 65.5, bodyFat: 20 });
  const third = await storage.addBodyMeasurement({ date: "2026-10-01", weight: 65.4 });
  assert.notEqual(second.id, third.id);
  assert.equal(Object.keys(storage.getCachedBodyMeasurements()).length, 3);
  assert.equal(storage.getCachedBodyMeasurements()[first.id].height, 175);
  assert.ok(local.get(storage.localKey).includes(second.id));
  const restored = JSON.parse(local.get(storage.localKey));
  assert.equal(Object.keys(restored.bodyMeasurements.__local__).length, 3);
  await assert.rejects(storage.addBodyMeasurement({ date: "2026-10-01" }));
  assert.equal(Object.keys(storage.getCachedBodyMeasurements()).length, 3);
});

test("body records migrate to the signed-in account, merge remote history and stay isolated by account", async () => {
  storage.setUser(null, null);
  const guest = await storage.addBodyMeasurement({ date: "2026-10-01", weight: 65 });
  const remote = { id: "remote", date: "2026-09-01", height: 175, createdAt: "2026-09-01T00:00:00Z" };
  mock.documents.set("users/test", { bodyMeasurements: { remote } });
  storage.setUser({ uid: "test" }, {});
  await storage.getProfile();
  await settleBodySync();
  assert.deepEqual(Object.keys(storage.getCachedBodyMeasurements()).sort(), [guest.id, "remote"].sort());
  assert.equal(Object.keys(mock.documents.get("users/test").bodyMeasurements).length, 2);
  assert.deepEqual(storage._loadLocal().bodyMeasurementPending.test, {});
  storage.setUser({ uid: "another" }, {});
  assert.deepEqual(storage.getCachedBodyMeasurements(), {});
  storage.setUser({ uid: "test" }, {});
  assert.equal(Object.keys(storage.getCachedBodyMeasurements()).length, 2);
  storage.setUser(null, null);
  assert.deepEqual(storage.getCachedBodyMeasurements(), {});
});

test("failed body uploads persist across restart and unrelated profile writes do not clear the failure", async () => {
  mock.denied.add(undefined); // The user document has no collection segment.
  const entry = await storage.addBodyMeasurement({ date: "2026-10-01", weight: 65 });
  await settleBodySync();
  assert.equal(storage.syncStatus.failures[0].label, "身体档案");
  mock.denied.clear();
  await storage.updateProfile({ dailyGoal: 2500 });
  assert.equal(storage.syncStatus.failures[0].label, "身体档案");
  storage.setUser({ uid: "test" }, {}); // Simulates reloading the app with the same local cache.
  await storage.getProfile();
  await settleBodySync();
  assert.equal(mock.documents.get("users/test").bodyMeasurements[entry.id].weight, 65);
  assert.equal(storage.syncStatus.state, "synced");
  assert.deepEqual(storage._loadLocal().bodyMeasurementPending.test, {});
});

test("deleting a body record syncs a tombstone without removing other measurements", async () => {
  const first = await storage.addBodyMeasurement({ date: "2026-09-01", height: 175 });
  const second = await storage.addBodyMeasurement({ date: "2026-10-01", weight: 65 });
  await settleBodySync();
  await storage.deleteBodyMeasurement(first.id);
  await settleBodySync();
  const cloud = mock.documents.get("users/test").bodyMeasurements;
  assert.equal(cloud[first.id].deleted, true);
  assert.equal(cloud[second.id].weight, 65);
  await storage.getProfile();
  assert.equal(storage.getCachedBodyMeasurements()[first.id].deleted, true);
});

test("body save reports storage failure instead of showing a false success", async () => {
  storage.setUser(null, null);
  const original = localStorage.setItem;
  const originalError = console.error, originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  localStorage.setItem = () => { throw new Error("Quota exceeded"); };
  try {
    await assert.rejects(storage.addBodyMeasurement({ date: "2026-10-01", weight: 65 }), /未保存/);
    assert.deepEqual(storage.getCachedBodyMeasurements(), {});
  } finally { localStorage.setItem = original; console.error = originalError; console.warn = originalWarn; }
});

test("failed creates retry with the same ID and do not duplicate records", async () => {
  mock.denied.add("waterLogs");
  const record = await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-11" });
  assert.equal(storage._loadLocal().records["2026-10-11"].water[0].id, record.id);
  mock.denied.clear();
  await storage.retryFailedRequests();
  await storage.mergeLocalToCloud();
  assert.equal([...mock.documents.keys()].filter(path => path.includes("waterLogs/")).length, 1);
  assert.equal(storage.syncStatus.state, "synced");
});

test("deleting an unuploaded record replaces its pending create", async () => {
  mock.denied.add("waterLogs");
  const record = await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-11" });
  await storage.deleteWaterLog(record.id);
  mock.denied.clear();
  await storage.retryFailedRequests();
  assert.equal(mock.documents.size, 0);
  assert.equal(storage._loadLocal().records["2026-10-11"].water.length, 0);
});

test("a newer partial edit preserves fields from a failed create", async () => {
  mock.denied.add("waterLogs");
  const record = await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-11" });
  mock.denied.clear();
  const time = new Date("2026-10-11T12:00:00Z");
  await storage.updateWaterLogTime(record.id, time);
  await settleBodySync();
  const cloud = mock.documents.get(`users/test/waterLogs/${record.id}`);
  assert.equal(cloud.amount, 300);
  assert.equal(cloud.recordedAt.toISOString(), time.toISOString());
  assert.equal(storage.syncStatus.state, "synced");
});

test("merge skips empty categories and never uploads after a failed dedupe query", async () => {
  storage.setUser(null, null);
  await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-11" });
  storage.setUser({ uid: "test" }, {});
  mock.denied.add("waterLogs");
  await storage.mergeLocalToCloud();
  assert.equal(mock.reads.some(path => path.includes("mealLogs")), false);
  assert.equal(mock.writes.some(path => path.includes("waterLogs")), false);
  mock.denied.clear();
  await storage.retryFailedRequests();
  await storage.mergeLocalToCloud();
  await storage.mergeLocalToCloud();
  assert.equal([...mock.documents.keys()].filter(path => path.includes("waterLogs/")).length, 1);
});

test("history shares concurrent reads and reuses even an empty result on reopening", async () => {
  const [first, second] = await Promise.all([storage.getAllHistory(), storage.getAllHistory()]);
  assert.deepEqual(first, []);
  assert.strictEqual(first, second);
  assert.equal(mock.reads.length, 6);
  assert.strictEqual(await storage.getAllHistory(), first);
  assert.equal(mock.reads.length, 6);
});

test("cached history stays available during refresh and changes after adding or deleting", async () => {
  await storage.getAllHistory();
  const record = await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-11" });
  assert.deepEqual(storage.getCachedHistory(), []);
  const days = await storage.getAllHistory();
  assert.equal(days[0].waterTotal, 300);
  storage.historyCache.loadedAt = Date.now() - 60_001;
  mock.documents.set("users/test/waterLogs/other", { amount: 200, logDate: "2026-10-10" });
  assert.strictEqual(storage.getCachedHistory(), days);
  assert.equal((await storage.getAllHistory()).length, 2);
  await storage.deleteWaterLog(record.id);
  assert.deepEqual((await storage.getAllHistory()).map(day => day.dateKey), ["2026-10-10"]);
});

test("local history reflects count, time, meal, workout and deletion edits", async () => {
  storage.setUser(null, null);
  const record = await storage.addLog("medicine", { name: "EVA", count: 1, logDate: "2026-10-11" });
  assert.equal(storage.getCachedHistory()[0].medRecs.length, 1);
  await storage.getAllHistory();
  const time = new Date("2026-10-11T12:00:00Z");
  await storage.updateLogCount("medicine", record.id, 2, time);
  assert.equal((await storage.getAllHistory())[0].medRecs[0].count, 2);
  await storage.updateLogTime("medicine", record.id, new Date("2026-10-11T13:00:00Z"));
  assert.equal((await storage.getAllHistory())[0].medRecs[0].recordedAt.getUTCHours(), 13);
  const meal = await storage.addLog("meal", { mealType: "lunch", name: "午餐", logDate: "2026-10-11" });
  assert.equal((await storage.getAllHistory())[0].mealRecs.length, 1);
  await storage.saveWorkoutDetail("2026-10-11", { activity: "跑步", duration: 30 });
  assert.equal((await storage.getAllHistory())[0].workoutDetail.activity, "跑步");
  await storage.setWorkoutDay("2026-10-11", false);
  assert.equal((await storage.getAllHistory())[0].isWorkout, false);
  await storage.deleteLog("medicine", record.id);
  await storage.deleteLog("meal", meal.id);
  assert.deepEqual(await storage.getAllHistory(), []);
});

test("an in-flight history read cannot overwrite a newer edit or account", async () => {
  const fetchHistory = storage._fetchAllHistory;
  let finishOld;
  storage._fetchAllHistory = () => new Promise(resolve => { finishOld = resolve; });
  try {
    const oldRead = storage.getAllHistory();
    storage._fetchAllHistory = fetchHistory;
    await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-11" });
    const current = await storage.getAllHistory();
    finishOld([]);
    assert.strictEqual(await oldRead, current);
    assert.equal(storage.getCachedHistory()[0].waterTotal, 300);

    storage.invalidateHistory();
    storage._fetchAllHistory = () => new Promise(resolve => { finishOld = resolve; });
    const previousAccount = storage.getAllHistory();
    storage.setUser({ uid: "another" }, {});
    storage._fetchAllHistory = fetchHistory;
    const nextAccount = await storage.getAllHistory();
    finishOld(current);
    assert.strictEqual(await previousAccount, nextAccount);
    assert.deepEqual(storage.getCachedHistory(), []);
  } finally {
    storage._fetchAllHistory = fetchHistory;
  }
});

test("history ranges include today and cross month/year boundaries correctly", () => {
  assert.deepEqual(historyRange(7, new Date(2026, 0, 3)), { startDate: "2025-12-28", endDate: "2026-01-03" });
  assert.deepEqual(historyRange(30, new Date(2024, 2, 1)), { startDate: "2024-02-01", endDate: "2024-03-01" });
});

test("week and month query only their range, without showing partial local or all-history caches", async () => {
  const now = new Date(2026, 9, 12);
  for (let offset = -1; offset < 40; offset++) {
    const date = new Date(now); date.setDate(date.getDate() - offset);
    const dateKey = historyRange(1, date).endDate;
    mock.documents.set(`users/test/waterLogs/day-${offset}`, { logDate: dateKey, amount: 300 });
    mock.documents.set(`users/test/workoutLogs/${dateKey}`, { isWorkout: true, activity: "跑步" });
  }
  storage._saveLocal({ ...storage._emptyData(), records: {
    "2026-10-12": { water: [{ amount: 300 }], medicine: [], supplement: [], toilet: [], meal: [] },
  } });
  assert.equal((await storage.getAllHistory()).length, 41);
  const week = historyRange(7, now), month = historyRange(30, now);
  assert.equal(storage.getCachedHistoryRange(week), null);
  mock.queries.length = 0;
  const [weekDays, sameWeek] = await Promise.all([storage.getHistoryRange(week), storage.getHistoryRange(week)]);
  assert.strictEqual(weekDays, sameWeek);
  assert.equal(weekDays.length, 7);
  assert.equal(weekDays[6].dateKey, "2026-10-06");
  assert.equal(weekDays[6].isWorkout, true);
  assert.equal(mock.queries.length, 6);
  for (const ref of mock.queries) {
    const field = ref.path.endsWith("workoutLogs") ? "__name__" : "logDate";
    assert.deepEqual(ref.constraints, [[field, ">=", week.startDate], [field, "<=", week.endDate]]);
  }
  assert.equal(storage.getCachedHistoryRange(month), null);
  assert.equal((await storage.getHistoryRange(month)).length, 30);
  assert.strictEqual(await storage.getHistoryRange(week), weekDays);
  assert.equal(mock.queries.length, 12);
});

test("assistant fresh reads bypass minute caches and include a meal and target updated on another device", async () => {
  const now = new Date(2026, 9, 17), range = { startDate: "0001-01-01", endDate: "2026-10-17" };
  const meal = { logDate: range.endDate, name: "晚餐", nutrition: { kcal: 600, carbsG: 50, proteinG: 20, fatG: 30 } };
  mock.documents.set("users/test/mealLogs/dinner", meal);
  await storage.getHistoryRange(range);
  mock.documents.set("users/test/mealLogs/dinner", { ...meal, nutrition: { ...meal.nutrition, fatG: 85 } });
  mock.documents.set("users/test", { nutritionGoal: { weightKg: 70, ratios: { carbsG: 3, proteinG: 1.6, fatG: 0.8 } } });
  assert.equal((await storage.getHistoryRange(range))[0].mealRecs[0].nutrition.fatG, 30);
  const [days, profile] = await Promise.all([storage.getHistoryRange(range, { force: true }), storage.getProfile({ force: true })]);
  const context = buildHealthContext(days, { categories: ["meal"], rangeDays: "all", profile, compact: true, now });
  assert.equal(context.todayNutrition.fatG, 85); assert.equal(context.dailyNutritionTargetsG.fatG, 56);
  assert.equal(days[0].mealRecs.length, 1);
  navigator.onLine = false;
  await assert.rejects(storage.getHistoryRange(range, { force: true }), { code: "unavailable" });
  assert.strictEqual(await storage.getHistoryRange(range), days);
});

test("an older background read cannot overwrite a fresh assistant snapshot", async () => {
  const original = storage._fetchAllHistory, finish = [], range = historyRange(7, new Date(2026, 9, 17));
  storage._fetchAllHistory = () => new Promise(resolve => finish.push(resolve));
  try {
    const background = storage.getHistoryRange(range), fresh = storage.getHistoryRange(range, { force: true });
    assert.equal(finish.length, 2);
    const latest = [{ dateKey: "2026-10-17", waterTotal: 900 }];
    finish[1](latest); await fresh;
    finish[0]([{ dateKey: "2026-10-17", waterTotal: 300 }]); await background;
    assert.strictEqual(storage.getCachedHistoryRange(range), latest);
  } finally { storage._fetchAllHistory = original; }
});

test("assistant profile refresh does not silently use cached targets after a failed read", async () => {
  mock.denied.add(undefined);
  await assert.rejects(storage.getProfile({ force: true }));
  assert.ok(await storage.getProfile());
});

test("empty ranges are complete caches and do not borrow older month records", async () => {
  const week = historyRange(7, new Date(2026, 9, 12));
  const month = historyRange(30, new Date(2026, 9, 12));
  mock.documents.set("users/test/waterLogs/old", { logDate: "2026-10-01", amount: 300 });
  assert.deepEqual(await storage.getHistoryRange(week), []);
  assert.equal((await storage.getHistoryRange(month)).length, 1);
  assert.deepEqual(storage.getCachedHistoryRange(week), []);
  assert.deepEqual(await storage.getHistoryRange(week), []);
  assert.equal(mock.queries.length, 12);
});

test("range refresh failures preserve the complete snapshot and never cache partial fallback data", async () => {
  const week = historyRange(7, new Date(2026, 9, 12));
  mock.denied.add("waterLogs");
  await assert.rejects(storage.getHistoryRange(week));
  assert.equal(storage.getCachedHistoryRange(week), null);
  mock.denied.clear();
  mock.documents.set("users/test/waterLogs/current", { logDate: "2026-10-12", amount: 300 });
  const complete = await storage.getHistoryRange(week);
  storage.invalidateHistory();
  mock.denied.add("waterLogs");
  await assert.rejects(storage.getHistoryRange(week));
  assert.strictEqual(storage.getCachedHistoryRange(week), complete);
});

test("range caches refresh after writes, exclude local meals outside the range and do not duplicate meals", async () => {
  const week = historyRange(7, new Date(2026, 9, 12));
  const month = historyRange(30, new Date(2026, 9, 12));
  await storage.getHistoryRange(week);
  await storage.getHistoryRange(month);
  const current = await storage.addLog("meal", { name: "午餐", mealType: "lunch", logDate: "2026-10-12" });
  await storage.addLog("meal", { name: "午餐", mealType: "lunch", logDate: "2026-10-01" });
  await storage.addLog("meal", { name: "午餐", mealType: "lunch", logDate: "2026-08-01" });
  const days = await storage.getHistoryRange(week);
  assert.equal(days.length, 1);
  assert.equal(days[0].mealRecs.length, 1);
  assert.equal((await storage.getHistoryRange(month)).length, 2);
  await storage.deleteLog("meal", current.id);
  assert.deepEqual(await storage.getHistoryRange(week), []);
});

test("out-of-order range requests and account changes cannot replace another range snapshot", async () => {
  const fetchHistory = storage._fetchAllHistory;
  const week = historyRange(7, new Date(2026, 9, 12));
  const month = historyRange(30, new Date(2026, 9, 12));
  const finish = new Map();
  storage._fetchAllHistory = range => new Promise(resolve => finish.set(range.startDate, resolve));
  try {
    const weekRead = storage.getHistoryRange(week);
    const monthRead = storage.getHistoryRange(month);
    finish.get(month.startDate)([{ dateKey: "2026-10-01" }]);
    await monthRead;
    assert.equal(storage.getCachedHistoryRange(week), null);
    finish.get(week.startDate)([]);
    await weekRead;
    assert.deepEqual(storage.getCachedHistoryRange(week), []);
    assert.equal(storage.getCachedHistoryRange(month)[0].dateKey, "2026-10-01");

    storage.invalidateHistory();
    const oldAccount = storage.getHistoryRange(week);
    storage.setUser({ uid: "another" }, {});
    storage._fetchAllHistory = fetchHistory;
    assert.equal(storage.getCachedHistoryRange(month), null);
    finish.get(week.startDate)([{ dateKey: "2026-10-12" }]);
    assert.deepEqual(await oldAccount, []);
    assert.deepEqual(storage.getCachedHistoryRange(week), []);
  } finally {
    storage._fetchAllHistory = fetchHistory;
  }
});

test("complete month snapshots survive restart, restore timestamps and remain isolated by account", async () => {
  const range = { startDate: "2026-10-01", endDate: "2026-10-12" };
  mock.documents.set("users/test/waterLogs/record", { logDate: "2026-10-12", amount: 500, recordedAt: { seconds: 1791806400, nanoseconds: 0 } });
  await storage.getHistoryRange(range);
  storage.setUser({ uid: "test" }, {});
  const cached = storage.getCachedHistoryRange(range);
  assert.equal(cached[0].waterTotal, 500);
  assert.ok(cached[0].waterRecs[0].recordedAt instanceof Date);
  navigator.onLine = false;
  assert.strictEqual(await storage.getHistoryRange(range), cached);
  storage.setUser({ uid: "another" }, {});
  assert.equal(storage.getCachedHistoryRange(range), null);
  await assert.rejects(storage.getHistoryRange(range), { code: "unavailable" });
});

test("an incomplete Firestore cache cannot be saved as a complete month snapshot", async () => {
  const range = { startDate: "2026-10-01", endDate: "2026-10-12" };
  mock.documents.set("users/test/waterLogs/partial", { logDate: "2026-10-12", amount: 500 });
  mock.cachedReads.add("waterLogs");
  await assert.rejects(storage.getHistoryRange(range), { code: "unavailable" });
  assert.equal(storage.getCachedHistoryRange(range), null);
  storage.setUser({ uid: "test" }, {});
  assert.equal(storage.getCachedHistoryRange(range), null);
});


test("meal photos are stored separately, sync with the record, and survive cloud/offline reads", async () => {
  const photo = "data:image/jpeg;base64,YQ==";
  const record = await storage.saveMealRecord({ mealType: "lunch", name: "", note: "", photos: [photo], logDate: "2026-10-12", recordedAt: new Date("2026-10-12T04:25:00Z") });
  assert.equal(local.get(storage.localKey).includes('"photos":'), false);
  await settleBodySync();
  assert.deepEqual(mock.documents.get(`users/test/mealLogs/${record.id}`).photos, [photo]);
  assert.deepEqual((await storage.getLogs("meal", "2026-10-12"))[0].photos, [photo]);
  mock.denied.add("mealLogs");
  assert.deepEqual((await storage.getLogs("meal", "2026-10-12"))[0].photos, [photo]);
});

test("meal edits update the same ID, preserve images and honor changed meal time", async () => {
  const photo = "data:image/jpeg;base64,YQ==";
  const original = await storage.saveMealRecord({ mealType: "lunch", name: "米饭", photos: [photo], logDate: "2026-10-12" });
  const time = new Date("2026-10-12T05:10:00Z");
  await storage.saveMealRecord({ ...original, name: "米饭和蔬菜", mealType: "dinner", recordedAt: time }, original.id);
  const rows = await storage.getLogs("meal", "2026-10-12");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, original.id);
  assert.equal(rows[0].name, "米饭和蔬菜");
  assert.deepEqual(rows[0].photos, [photo]);
  assert.equal(rows[0].recordedAt.toISOString(), time.toISOString());
  assert.equal([...mock.documents.keys()].filter(key => key.includes("mealLogs")).length, 1);
});

test("an offline meal edit survives restart and overwrites its cloud record without duplication", async () => {
  const original = await storage.saveMealRecord({ mealType: "lunch", name: "午餐", logDate: "2026-10-12" });
  mock.denied.add("mealLogs");
  await storage.saveMealRecord({ ...original, name: "补充后的午餐", photos: ["data:image/jpeg;base64,Yg=="] }, original.id);
  storage.setUser({ uid: "test" }, {});
  mock.denied.clear();
  assert.equal((await storage.getLogs("meal", "2026-10-12"))[0].name, "补充后的午餐");
  await storage.mergeLocalToCloud();
  const rows = await storage.getLogs("meal", "2026-10-12");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "补充后的午餐");
  assert.deepEqual(rows[0].photos, ["data:image/jpeg;base64,Yg=="]);
  assert.equal(rows[0].mealPending, undefined);
});

test("cloud-only meals cache locally so they remain editable and deletable", async () => {
  mock.documents.set("users/test/mealLogs/remote", { mealType: "breakfast", name: "燕麦", logDate: "2026-10-12", recordedAt: new Date("2026-10-12T00:00:00Z"), photos: ["data:image/jpeg;base64,YQ=="] });
  const [record] = await storage.getLogs("meal", "2026-10-12");
  await storage.saveMealRecord({ ...record, name: "燕麦和牛奶" }, record.id);
  await settleBodySync();
  assert.equal(mock.documents.get("users/test/mealLogs/remote").name, "燕麦和牛奶");
  await storage.deleteLog("meal", record.id);
  await settleBodySync();
  assert.equal(mock.documents.has("users/test/mealLogs/remote"), false);
  assert.equal((await storage.getLogs("meal", "2026-10-12")).length, 0);
});

test("meal storage failures never prune history or claim a successful save", async () => {
  const save = localStorage.setItem;
  storage.setUser(null, null);
  const original = await storage.saveMealRecord({ mealType: "lunch", name: "旧记录", logDate: "2025-01-01" });
  localStorage.setItem = () => { throw new Error("quota"); };
  try {
    await assert.rejects(storage.saveMealRecord({ mealType: "lunch", name: "未保存", logDate: "2026-10-12" }), /未保存/);
  } finally { localStorage.setItem = save; }
  assert.equal((await storage.getLogs("meal", "2025-01-01"))[0].id, original.id);
  assert.equal((await storage.getLogs("meal", "2026-10-12")).length, 0);
});

test("history replaces an old cloud meal with its pending local edit and does not cache image bytes", async () => {
  const record = await storage.saveMealRecord({ mealType: "lunch", name: "原午餐", logDate: "2026-10-12", photos: ["data:image/jpeg;base64,YQ=="] });
  mock.denied.add("mealLogs");
  await storage.saveMealRecord({ ...record, name: "修改后的午餐", recordedAt: new Date("2026-10-12T05:30:00Z") }, record.id);
  mock.denied.clear();
  const days = await storage.getHistoryRange(historyRange(30, new Date(2026, 9, 12)));
  assert.equal(days[0].mealRecs.length, 1);
  assert.equal(days[0].mealRecs[0].name, "修改后的午餐");
  assert.equal(days[0].mealRecs[0].photos, undefined);
  assert.equal(local.get("health_tracker_data:history:test").includes("data:image/jpeg"), false);
});


test("offline or incomplete cloud snapshots never erase cached meal photos", async () => {
  const original = await storage.saveMealRecord({ mealType: "lunch", name: "午餐", photos: ["data:image/jpeg;base64,YQ=="], logDate: "2026-10-12" });
  mock.documents.delete(`users/test/mealLogs/${original.id}`);
  navigator.onLine = false;
  mock.reads.length = 0;
  assert.equal((await storage.getLogs("meal", "2026-10-12"))[0].id, original.id);
  assert.equal(mock.reads.length, 0);
  navigator.onLine = true;
  mock.cachedReads.add("mealLogs");
  const [record] = await storage.getLogs("meal", "2026-10-12");
  assert.equal(record.id, original.id);
  assert.deepEqual(record.photos, ["data:image/jpeg;base64,YQ=="]);
});

test("recording and adjusting every daily log completes while cloud writes are blocked", async () => {
  let release;
  mock.writeGate = new Promise(resolve => { release = resolve; });
  try {
    // A timeout here is a regression: the UI awaits these methods before rendering.
    const saved = await Promise.race([
      (async () => {
        const date = "2026-10-12", time = new Date("2026-10-12T04:25:00Z");
        const water = await storage.addWaterLog({ amount: 300, source: "水", logDate: date });
        const medicine = await storage.addLog("medicine", { name: "药物", count: 1, logDate: date });
        await storage.updateLogCount("medicine", medicine.id, 2, time);
        await storage.addLog("supplement", { name: "补剂", count: 1, logDate: date });
        await storage.addLog("toilet", { type: "small", logDate: date });
        const meal = await storage.saveMealRecord({ mealType: "lunch", name: "午餐", logDate: date, photos: ["data:image/jpeg;base64,YQ=="] });
        await storage.saveWorkoutDetail(date, { activity: "跑步", duration: 30 });
        assert.equal((await storage.getWaterLogs(date))[0].id, water.id);
        assert.equal((await storage.getLogs("medicine", date))[0].count, 2);
        assert.equal((await storage.getLogs("meal", date))[0].id, meal.id);
        assert.equal((await storage.getWorkoutDetail(date)).activity, "跑步");
        const [day] = await storage.getAllHistory();
        assert.equal(day.waterTotal, 300);
        assert.equal(day.medRecs[0].count, 2);
        assert.equal(day.mealRecs.length, 1);
        assert.equal(day.isWorkout, true);
        const [stats] = await storage.getHistory([date]);
        assert.equal(stats.waterTotal, 300);
        assert.equal(stats.medRecs[0].count, 2);
        assert.equal(stats.mealRecs.length, 1);
        assert.equal(stats.isWorkout, true);
        return storage._pendingRecordChanges().length;
      })(),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("保存仍在等待云端")), 250); timer.unref(); }),
    ]);
    assert.equal(saved, 6);
    assert.equal(mock.documents.size, 0);
    assert.equal(storage.syncStatus.state, "syncing");
  } finally { release(); mock.writeGate = null; await settleBodySync(); }
  assert.equal(mock.documents.size, 6);
  assert.equal(storage._pendingRecordChanges().length, 0);
  assert.equal(storage.syncStatus.state, "synced");
});

test("rapid count changes and delete-before-upload keep the latest intent and never resurrect a record", async () => {
  let release;
  mock.writeGate = new Promise(resolve => { release = resolve; });
  const time = new Date("2026-10-12T05:00:00Z");
  try {
    const med = await storage.addLog("medicine", { name: "药物", count: 1, logDate: "2026-10-12" });
    await storage.updateLogCount("medicine", med.id, 2, time);
    await storage.updateLogCount("medicine", med.id, 3, time);
    const water = await storage.addWaterLog({ source: "水", amount: 300, logDate: "2026-10-12" });
    await storage.deleteWaterLog(water.id);
    const meal = await storage.saveMealRecord({ mealType: "lunch", name: "午餐", logDate: "2026-10-12" });
    await storage.deleteLog("meal", meal.id);
    assert.deepEqual(await storage.getWaterLogs("2026-10-12"), []);
    assert.deepEqual(await storage.getLogs("meal", "2026-10-12"), []);
    assert.equal((await storage.getAllHistory())[0].medRecs[0].count, 3);
    assert.equal(storage._pendingRecordChanges().length, 3);
  } finally { release(); mock.writeGate = null; await settleBodySync(); }
  assert.equal(mock.documents.size, 1);
  assert.equal([...mock.documents.values()][0].count, 3);
  assert.equal(storage._pendingRecordChanges().length, 0);
});

test("pending edits and deletions survive restart, stay account-scoped and retry by document ID", async () => {
  const record = await storage.addLog("medicine", { name: "药物", count: 1, logDate: "2026-10-12" });
  const water = await storage.addWaterLog({ amount: 300, source: "水", logDate: "2026-10-12" });
  await settleBodySync();
  mock.denied.add("medicineLogs"); mock.denied.add("waterLogs");
  await storage.updateLogCount("medicine", record.id, 2, new Date());
  await storage.deleteWaterLog(water.id);
  await settleBodySync();
  storage.setUser({ uid: "another" }, {});
  assert.equal(storage._pendingRecordChanges().length, 0);
  await storage.mergeLocalToCloud();
  assert.equal(mock.writes.some(path => path.startsWith("users/another/")), false);
  storage.setUser({ uid: "test" }, {});
  assert.equal((await storage.getLogs("medicine", "2026-10-12"))[0].count, 2);
  assert.deepEqual(await storage.getWaterLogs("2026-10-12"), []);
  mock.denied.clear();
  await storage.mergeLocalToCloud();
  assert.equal(mock.documents.get(`users/test/medicineLogs/${record.id}`).count, 2);
  assert.equal(mock.documents.has(`users/test/waterLogs/${water.id}`), false);
  assert.equal(storage._pendingRecordChanges().length, 0);
});

test("daily record storage failure never reports success or starts a cloud write", async () => {
  const save = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("quota"); };
  try {
    await assert.rejects(storage.addWaterLog({ amount: 300, source: "水" }), /未保存/);
    await assert.rejects(storage.addLog("medicine", { name: "药物", count: 1 }), /未保存/);
    await assert.rejects(storage.saveWorkoutDetail("2026-10-12", { activity: "跑步" }), /未保存/);
    assert.equal(mock.writes.length, 0);
    assert.equal(storage._pendingRecordChanges().length, 0);
    assert.equal(Object.keys(storage._loadLocal().records).length, 0);
  } finally { localStorage.setItem = save; }
});

test("startup publishes the cached day synchronously while reads and pending uploads are blocked", async () => {
  storage.setUser(null, null);
  const date = "2026-10-12";
  await storage.addWaterLog({ amount: 490, source: "水", logDate: date });
  await storage.addLog("medicine", { name: "药物", count: 1, logDate: date });
  await storage.saveMealRecord({ mealType: "lunch", name: "午餐", logDate: date, photos: ["data:image/jpeg;base64,YQ=="] });
  await storage.saveWorkoutDetail(date, { activity: "跑步", duration: 30 });
  storage.setUser({ uid: "test" }, {});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = () => gate; mock.writeGate = gate;
  const updates = [];
  const upload = storage.mergeLocalToCloud();
  const refresh = loadDaySnapshot(storage, date, value => updates.push(value));
  try {
    assert.equal(updates.length, 1); // Before even a microtask or server response.
    assert.equal(updates[0].water[0].amount, 490);
    assert.equal(updates[0].medicine[0].count, 1);
    assert.equal(updates[0].meal[0].name, "午餐");
    assert.equal(updates[0].workout.duration, 30);
    await settleBodySync();
    assert.deepEqual(updates.find(value => value.meal?.[0]?.photos)?.meal[0].photos, ["data:image/jpeg;base64,YQ=="]);
  } finally { release(); mock.readGate = null; mock.writeGate = null; await Promise.all([upload, refresh]); }
});

test("a stalled meal read cannot delay water, medicine or workout updates or trigger month queries", async () => {
  const date = "2026-10-12";
  mock.documents.set("users/test/waterLogs/remote", { amount: 550, source: "水", logDate: date, recordedAt: new Date() });
  mock.documents.set("users/test/medicineLogs/remote", { name: "药物", count: 2, logDate: date, recordedAt: new Date() });
  mock.documents.set(`users/test/workoutLogs/${date}`, { isWorkout: true, duration: 45 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = ref => ref.path.endsWith("mealLogs") ? gate : null;
  const updates = [];
  const refresh = loadDaySnapshot(storage, date, value => updates.push(value));
  try {
    await settleBodySync();
    assert.equal(updates.find(value => value.water?.[0])?.water[0].amount, 550);
    assert.equal(updates.find(value => value.medicine?.[0])?.medicine[0].count, 2);
    assert.equal(updates.find(value => value.workout?.isWorkout)?.workout.duration, 45);
    assert.equal(mock.reads.length, 6);
    assert.ok(mock.queries.every(ref => ref.constraints.some(([key, op, value]) => key === "logDate" && op === "==" && value === date)));
  } finally { release(); mock.readGate = null; await refresh; }
});

test("stale startup responses cannot erase records added while syncing, even after upload acknowledgement", async () => {
  const date = "2026-10-12";
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = () => gate;
  const refreshWater = storage.getWaterLogs(date);
  const refreshMedicine = storage.getLogs("medicine", date);
  const refreshWorkout = storage.getWorkoutDetail(date);
  await storage.addWaterLog({ amount: 490, source: "水", logDate: date });
  await storage.addLog("medicine", { name: "药物", count: 2, logDate: date });
  await storage.saveWorkoutDetail(date, { activity: "跑步", duration: 30 });
  await settleBodySync();
  assert.equal(storage._pendingRecordChanges().length, 0);
  // Simulate a server read returning the empty state it saw before these writes.
  mock.documents.clear();
  release(); mock.readGate = null;
  assert.equal((await refreshWater)[0].amount, 490);
  assert.equal((await refreshMedicine)[0].count, 2);
  assert.equal((await refreshWorkout).duration, 30);
  assert.equal(storage.getCachedDay(date).water[0].amount, 490);
});

test("offline day loading skips network requests and old date/account callbacks never repaint", async () => {
  const date = "2026-10-12";
  await storage.addWaterLog({ amount: 490, source: "水", logDate: date });
  await settleBodySync();
  mock.reads.length = 0; navigator.onLine = false;
  const offline = [];
  await loadDaySnapshot(storage, date, value => offline.push(value));
  assert.equal(offline[0].water[0].amount, 490);
  assert.equal(mock.reads.length, 0);
  navigator.onLine = true;
  let release, selected = true;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = () => gate;
  const updates = [];
  const refresh = loadDaySnapshot(storage, date, value => updates.push(value), () => selected);
  selected = false;
  storage.setUser({ uid: "another" }, {});
  const count = updates.length;
  release(); mock.readGate = null;
  await refresh;
  assert.equal(updates.length, count);
});

test("a slow profile refresh never overwrites a locally changed goal", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = () => gate;
  const refresh = storage.getProfile();
  await storage.updateProfile({ dailyGoal: 2500 });
  mock.documents.set("users/test", { dailyGoal: 2000 });
  release(); mock.readGate = null;
  assert.equal((await refresh).dailyGoal, 2500);
  assert.equal(storage.getCachedProfile().dailyGoal, 2500);
});

test("a remote workout deletion clears cached details instead of leaving an old training day", async () => {
  const date = "2026-10-12";
  await storage.saveWorkoutDetail(date, { activity: "跑步", duration: 30 });
  await settleBodySync();
  mock.documents.delete(`users/test/workoutLogs/${date}`);
  assert.deepEqual(await storage.getWorkoutDetail(date), { isWorkout: false });
  assert.deepEqual(storage.getCachedDay(date).workout, { isWorkout: false });
});

test("an unacknowledged upload cannot keep syncing forever or clear its durable record", async () => {
  storage.sync.timeoutMs = 10;
  let release;
  mock.writeGate = new Promise(resolve => { release = resolve; });
  const record = await storage.addWaterLog({ amount: 490, source: "水", logDate: "2026-10-12" });
  assert.equal(storage.syncStatus.state, "syncing");
  await storage.mergeLocalToCloud();
  assert.equal(storage.sync.pending, 0);
  assert.equal(storage.syncBatchPending, false);
  assert.equal(storage.syncStatus.state, "error");
  assert.equal(storage.syncStatus.failures[0].code, "deadline-exceeded");
  assert.equal(storage._pendingRecordChanges()[0].id, record.id);
  assert.equal(storage.getCachedDay("2026-10-12").water[0].amount, 490);
  release(); mock.writeGate = null;
  await settleBodySync();
  assert.equal(storage._pendingRecordChanges().length, 0);
  assert.equal(storage.syncStatus.state, "synced");
  assert.equal(mock.documents.get(`users/test/waterLogs/${record.id}`).amount, 490);
});

test("a network timeout stops the legacy upload loop, preserves every day and recovers in one retry", async () => {
  storage.setUser(null, null);
  for (const date of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
    await storage.addWaterLog({ amount: 490, source: "水", logDate: date });
  }
  storage.setUser({ uid: "test" }, {});
  storage.sync.timeoutMs = 10;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = () => gate;
  await storage.mergeLocalToCloud();
  assert.equal(storage.syncBatchPending, false);
  assert.equal(storage.syncStatus.state, "error");
  assert.equal(mock.reads.length, 1);
  assert.equal(Object.keys(storage._loadLocal().pendingUpload).length, 3);
  assert.equal(mock.writes.length, 0);
  release(); mock.readGate = null;
  await settleBodySync();
  await storage.retryFailedRequests();
  await storage.mergeLocalToCloud();
  assert.equal(storage.syncStatus.state, "synced");
  assert.equal(storage.hasLocalData(), false);
  assert.equal(mock.documents.size, 3);
});

test("a stalled photo read releases the batch lock without sending expired data and can retry", async () => {
  storage.setUser(null, null);
  await storage.saveMealRecord({ mealType: "lunch", name: "午餐", logDate: "2026-10-12" });
  storage.setUser({ uid: "test" }, {});
  storage.syncBatchTimeoutMs = 10;
  const readPhotos = storage.readMealPhotos;
  let release;
  storage.readMealPhotos = () => new Promise(resolve => { release = resolve; });
  try {
    await storage.mergeLocalToCloud();
    assert.equal(storage.syncBatchPending, false);
    assert.equal(storage.sync.pending, 0);
    assert.equal(storage.syncStatus.state, "error");
    assert.equal(storage.syncStatus.failures[0].label, "记录上传");
    assert.equal(storage._loadLocal().pendingUpload["2026-10-12/meal"], true);
    assert.equal(mock.writes.length, 0);
  } finally { storage.readMealPhotos = readPhotos; release([]); await settleBodySync(); }
  assert.equal(mock.writes.length, 0);
  await storage.retryFailedRequests();
  assert.equal(storage.syncStatus.state, "synced");
  assert.equal(storage.hasLocalData(), false);
  assert.equal(mock.documents.size, 1);
});

test("existing failures remain visible while unrelated requests are running", async () => {
  mock.denied.add("waterLogs");
  await storage.addWaterLog({ amount: 490, source: "水", logDate: "2026-10-12" });
  await settleBodySync();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mock.readGate = () => gate;
  const reading = storage.getLogs("medicine", "2026-10-12");
  assert.ok(storage.sync.pending > 0);
  assert.equal(storage.syncStatus.state, "error");
  release(); mock.readGate = null;
  await reading;
});

test("persisted unsent records show pending after restart even if unrelated reads succeed", async () => {
  mock.denied.add("waterLogs");
  await storage.addWaterLog({ amount: 490, source: "水", logDate: "2026-10-12" });
  await settleBodySync();
  storage.setUser({ uid: "test" }, {});
  await storage.getProfile();
  assert.ok(storage.sync.lastSyncedAt);
  assert.equal(storage.syncStatus.state, "pending");
  assert.equal(storage._pendingRecordChanges().length, 1);
  mock.denied.clear();
  await storage.mergeLocalToCloud();
  assert.equal(storage.syncStatus.state, "synced");
});

test("meal nutrition survives local reload, cloud sync, manual edits and clearing an estimate", async () => {
  const nutrition = { kcal: 580, carbsG: 62, proteinG: 35, fatG: 21, source: "ai", portion: "一份", note: "估算" };
  const record = await storage.saveMealRecord({ mealType: "meal", name: "米饭鸡肉", logDate: "2026-10-16", nutrition });
  await settleBodySync();
  const path = `users/test/mealLogs/${record.id}`;
  assert.equal(mock.documents.get(path).nutrition.kcal, 580);
  const [cached] = await storage.getCachedMealLogs("2026-10-16");
  assert.equal(cached.nutrition.proteinG, 35);
  await storage.saveMealRecord({ ...record, nutrition: { ...nutrition, kcal: 620, source: "manual" } }, record.id);
  await settleBodySync();
  assert.equal(mock.documents.get(path).nutrition.source, "manual");
  assert.equal((await storage.getMealLogs("2026-10-16"))[0].nutrition.kcal, 620);
  await storage.saveMealRecord({ ...record, nutrition: null }, record.id);
  await settleBodySync();
  assert.equal(mock.documents.get(path).nutrition, null);
  await assert.rejects(storage.saveMealRecord({ ...record, nutrition: { ...nutrition, kcal: -1 } }, record.id), /无效/);
});
