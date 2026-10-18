import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { toDateKey } from "../js/utils.js";

const result = await build({
  stdin: { contents: 'export { storage } from "./js/storage.js"; export { mock } from "./tests/firebase-mock.mjs"; export * from "./js/assistant-actions.js";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "fake-firebase", setup(build) { build.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: new URL("./firebase-mock.mjs", import.meta.url).pathname })); } }],
});
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const local = new Map(); globalThis.localStorage = { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) };
const { storage, mock, buildActionCatalog, prepareAssistantAction, executeAssistantAction } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const today = toDateKey(new Date()), range = { startDate: "0001-01-01", endDate: today }, user = { uid: "test" };
const identity = { uid: "test", getUser: () => user };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const catalog = async () => buildActionCatalog(await storage.getHistoryRange(range, { force: true }), storage.getCachedBodyMeasurements(), storage.getCachedProfile());
const propose = async (operation, category, values = {}, ref = null) => prepareAssistantAction({ operation, category, values, ref, date: today, time: "12:30" }, await catalog());
beforeEach(() => {
  local.clear(); mock.documents.clear(); mock.denied.clear(); mock.cachedReads.clear(); mock.reads.length = 0; mock.writes.length = 0; mock.readGate = null; mock.writeGate = null;
  storage.mealPhotos = { put: async photos => photos.map(() => "photo-ref"), get: async () => ["data:image/jpeg;base64,YWJj"] };
  storage.setUser(user, {});
});

test("a proposal does not mutate storage; confirmation adds, updates and deletes one exact water record", async () => {
  const create = await propose("create", "water", { amount: 250 });
  assert.equal(storage.getCachedDay(today).water.length, 0);
  const saved = await executeAssistantAction(storage, create, identity); await settle();
  assert.equal(storage.getCachedDay(today).water[0].amount, 250);
  assert.equal(mock.documents.get(`users/test/waterLogs/${saved.id}`).amount, 250);
  await assert.rejects(executeAssistantAction(storage, create, identity), /已处理/);
  const latest = await catalog(), ref = latest.data.records.find(record => record.category === "water").ref;
  const update = prepareAssistantAction({ operation: "update", category: "water", ref, values: { amount: 350 }, date: today }, latest);
  await executeAssistantAction(storage, update, identity); await settle();
  assert.equal(storage.getCachedDay(today).water.length, 1); assert.equal(storage.getCachedDay(today).water[0].amount, 350);
  const removeCatalog = await catalog();
  const remove = prepareAssistantAction({ operation: "delete", category: "water", ref: removeCatalog.data.records[0].ref, values: {} }, removeCatalog);
  await executeAssistantAction(storage, remove, identity); await settle();
  assert.equal(storage.getCachedDay(today).water.length, 0); assert.ok(!mock.documents.has(`users/test/waterLogs/${saved.id}`));
});

test("unknown references, fields, impossible dates and partial nutrition never become executable writes", async () => {
  const data = await catalog();
  for (const action of [
    { operation: "delete", category: "water", ref: "guessed-id", values: {} },
    { operation: "create", category: "account", values: {} },
    { operation: "create", category: "water", values: { amount: -1 } },
    { operation: "create", category: "water", values: { amount: 250, uid: "other" } },
    { operation: "create", category: "water", date: "2099-01-01", values: { amount: 250 } },
    { operation: "create", category: "meal", values: { name: "午餐", mealType: "lunch", kcal: 500 } },
  ]) assert.throws(() => prepareAssistantAction(action, data));
  assert.equal(mock.writes.length, 0);
});

test("confirmation rejects stale records, account switches and double clicks during a read", async () => {
  const created = await executeAssistantAction(storage, await propose("create", "water", { amount: 250 }), identity); await settle();
  const data = await catalog(), ref = data.data.records[0].ref;
  const change = prepareAssistantAction({ operation: "update", category: "water", ref, values: { amount: 350 } }, data);
  mock.documents.set(`users/test/waterLogs/${created.id}`, { ...mock.documents.get(`users/test/waterLogs/${created.id}`), amount: 400 });
  await assert.rejects(executeAssistantAction(storage, change, identity), /发生变化/);
  assert.equal(mock.documents.get(`users/test/waterLogs/${created.id}`).amount, 400);
  await assert.rejects(executeAssistantAction(storage, change, { uid: "test", getUser: () => ({ uid: "another" }) }), /账号/);
  const fresh = await catalog(), update = prepareAssistantAction({ operation: "update", category: "water", ref: fresh.data.records[0].ref, values: { amount: 450 } }, fresh);
  let release; mock.readGate = () => new Promise(resolve => { release = resolve; });
  const first = executeAssistantAction(storage, update, identity);
  await assert.rejects(executeAssistantAction(storage, update, identity), /已处理/);
  mock.readGate = null; release(); await first;
});

test("meal edits retain photos and nutrition; all record categories use existing durable storage", async () => {
  const meal = await propose("create", "meal", { name: "午餐", mealType: "lunch", kcal: 600, carbsG: 70, proteinG: 25, fatG: 20, portion: "一份" });
  meal.after.photos = ["data:image/jpeg;base64,YWJj"];
  await executeAssistantAction(storage, meal, identity); await settle();
  const data = await catalog(), ref = data.data.records.find(record => record.category === "meal").ref;
  const edit = prepareAssistantAction({ operation: "update", category: "meal", ref, values: { fatG: 22 } }, data);
  await executeAssistantAction(storage, edit, identity); await settle();
  const [storedMeal] = await storage.getMealLogs(today); assert.equal(storedMeal.nutrition.fatG, 22); assert.equal(storedMeal.nutrition.proteinG, 25); assert.equal(storedMeal.photos.length, 1);
  for (const [category, values] of [
    ["medicine", { name: "已服药物", count: 1, dosage: "按原医嘱" }], ["supplement", { name: "已服补剂", count: 1 }],
    ["toilet", { type: "small" }], ["workout", { activity: "步行", duration: 20 }], ["body", { weight: 70, bodyFat: 18 }],
  ]) { await executeAssistantAction(storage, await propose("create", category, values), identity); await settle(); }
  assert.equal(storage.getCachedDay(today).medicine.length, 1); assert.equal(storage.getCachedDay(today).supplement.length, 1);
  assert.equal(storage.getCachedDay(today).toilet.length, 1); assert.equal(storage.getCachedDay(today).workout.duration, 20);
  assert.equal(Object.values(storage.getCachedBodyMeasurements())[0].weight, 70);
  const goals = await catalog();
  const goal = prepareAssistantAction({ operation: "update", category: "goals", ref: "goals", values: { waterGoalMl: 2400, goalWeightKg: 70, carbsRatio: 3, proteinRatio: 1.6, fatRatio: 0.8 } }, goals);
  await executeAssistantAction(storage, goal, identity);
  assert.equal(storage.getCachedProfile().dailyGoal, 2400); assert.equal(storage.getCachedProfile().nutritionGoal.weightKg, 70);
});

test("offline upload failure retains a local write intent instead of losing or duplicating the confirmed record", async () => {
  const change = await propose("create", "water", { amount: 300 });
  mock.denied.add("waterLogs");
  const result = await executeAssistantAction(storage, change, identity); await settle();
  assert.equal(storage.getCachedDay(today).water.length, 1);
  assert.equal(storage._pendingRecordChanges()[0].id, result.id);
  mock.denied.clear(); await storage.retryFailedRequests();
  assert.equal(mock.documents.get(`users/test/waterLogs/${result.id}`).amount, 300);
  assert.equal(storage.getCachedDay(today).water.length, 1);
});
