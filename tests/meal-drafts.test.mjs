import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { MealDraftStore, mealDraftKey, normalizeMealDraft } from "../js/meal-drafts.js";
import { MealTimeDraft } from "../js/meals.js";
import { normalizeMealNutrition, NUTRITION_FIELDS } from "../js/meal-nutrition.js";
const photo = "data:image/jpeg;base64,YQ==";
const snapshot = () => ({ version: 1, dateKey: "2026-11-06", name: "米饭与蔬菜", photos: [photo],
  nutrition: { kcal: 500, carbsG: 60, proteinG: 30, fatG: 15 }, nutritionValues: { kcal: "", carbsG: "60", proteinG: "30", fatG: "15" },
  time: "12:35", manual: true, captured: true });
const backend = () => ({ rows: new Map(), async get(key) { return this.rows.get(key); },
  async put(key, value) { this.rows.set(key, value); }, async delete(key) { this.rows.delete(key); } });
const drain = store => Promise.all([...store.tails.values()].map(promise => promise.catch(() => {})));

test("drafts survive a fresh store and retain photos, manual time and unfinished nutrition inputs", async () => {
  const db = backend(), key = mealDraftKey("account-A", "2026-11-06");
  await new MealDraftStore(db).save(key, snapshot());
  const restored = await new MealDraftStore(db).get(key);
  assert.equal(restored.name, "米饭与蔬菜"); assert.deepEqual(restored.photos, [photo]);
  assert.equal(restored.time, "12:35"); assert.equal(restored.manual, true);
  assert.equal(restored.nutritionValues.kcal, ""); assert.equal(restored.nutrition.kcal, 500);
});

test("accounts, dates, new meals, record edits and repeated meals have separate drafts", async () => {
  const db = backend(), store = new MealDraftStore(db);
  const scopes = [["A", "2026-11-06"], ["B", "2026-11-06"], ["A", "2026-11-05"],
    ["A", "2026-11-06", "record-1"], ["A", "2026-11-06", "record-2"], ["A", "2026-11-06", null, "record-1"]];
  assert.equal(new Set(scopes.map(args => mealDraftKey(...args))).size, scopes.length);
  for (const [index, args] of scopes.entries()) await store.save(mealDraftKey(...args), { ...snapshot(), name: `draft-${index}` });
  for (const [index, args] of scopes.entries()) assert.equal((await new MealDraftStore(db).get(mealDraftKey(...args))).name, `draft-${index}`);
});

test("a slow autosave finishes before discard, and cannot resurrect a draft", async () => {
  const db = backend(), original = db.put.bind(db);
  let release;
  db.put = async (...args) => { await new Promise(resolve => { release = resolve; }); await original(...args); };
  const store = new MealDraftStore(db), key = "draft";
  const saving = store.save(key, snapshot());
  await new Promise(resolve => setImmediate(resolve));
  const removing = store.remove(key); release();
  await Promise.all([saving, removing]);
  assert.equal(await new MealDraftStore(db).get(key), null);
});

test("storage failure retains the current draft in memory and the previous persistent version", async () => {
  const db = backend(), store = new MealDraftStore(db), key = "draft";
  await store.save(key, snapshot());
  assert.equal(store.isTemporary(key), false);
  db.put = async () => { throw new Error("quota"); };
  await assert.rejects(store.save(key, { ...snapshot(), name: "new text" }));
  assert.equal((await store.get(key)).name, "new text");
  assert.equal(store.isTemporary(key), true);
  assert.equal((await new MealDraftStore(db).get(key)).name, "米饭与蔬菜");
  assert.equal(normalizeMealDraft({ ...snapshot(), dateKey: "2026-02-30" }), null);
  assert.deepEqual(normalizeMealDraft({ ...snapshot(), photos: [photo, "https://example.com/private.jpg"] }).photos, [photo]);
});

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function editor(db = backend()) {
  const values = Object.fromEntries(NUTRITION_FIELDS.map(field => [field.key, { value: "" }]));
  const ids = ["mealKcalInput", "mealCarbsInput", "mealProteinInput", "mealFatInput", ...NUTRITION_FIELDS.slice(4).map(field => `mealExtra${field.key}`)];
  const fields = Object.fromEntries(ids.map((id, index) => [id, values[NUTRITION_FIELDS[index].key]]));
  const dialog = new EventTarget(); dialog.querySelector = () => ({ scrollTop: 0 });
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); };
  let focused = false;
  const E = { mealDialog: dialog, mealNameInput: { value: "", focus() { focused = true; } }, mealTimeInput: {},
    mealTimeHint: {}, mealDialogTitle: {}, mealPhotoMessage: {}, mealPhotoInput: {}, mealCameraInput: { click() {} },
    mealAIConnect: {}, mealDraftDiscard: { addEventListener(_, handler) { this.handler = handler; } }, mealDraftStatus: {}, mealForm: { reportValidity: () => true } };
  const store = new MealDraftStore(db), writes = [], notices = [];
  const c = vm.createContext({ E, mealDraft: null, mealSelectionVersion: 0, mealSaving: false, mealDayLoading: false,
    mealDraftSaveTimer: null, selectedDate: "2026-11-06", mealDraftStore: store, mealDraftKey, MealTimeDraft,
    normalizeMealNutrition, NUTRITION_FIELDS, MEAL_NUTRITION_INPUTS: ids, toJSDate: value => new Date(value),
    storage: { localKey: "account-A", sync: { generation: 1 }, saveMealRecord: async meal => { writes.push(meal); return { ...meal, id: "saved" }; } },
    document: { getElementById: id => fields[id] }, clearTimeout, setTimeout: () => 1,
    mealEditorKeyboard: { open() {}, close() {} }, renderMealPhotoDraft() {},
    renderMealNutrition() { ids.forEach((id, index) => { fields[id].value = c.mealDraft.nutrition?.[NUTRITION_FIELDS[index].key] ?? ""; }); },
    mealRecords: [], renderMeals() {}, updateDailyOverview() {}, nativeHaptic() {},
    readMealNutrition: () => null, showToast: message => notices.push(message), toFriendlyError: e => e.message });
  vm.runInContext(source.slice(source.indexOf("function mealDraftSnapshot("), source.indexOf("function captureMealTime(")), c);
  vm.runInContext(source.slice(source.indexOf("function captureMealTime("), source.indexOf("function renderMealPhotoDraft(")), c);
  vm.runInContext(source.slice(source.indexOf("async function handleMealSubmit("), source.indexOf("async function deleteMealRecord(")), c);
  vm.runInContext(source.slice(source.indexOf('E.mealDialog?.addEventListener("close"'), source.indexOf('document.addEventListener("visibilitychange", () => { if (document.hidden)')), c);
  vm.runInContext(source.slice(source.indexOf('E.mealDraftDiscard.addEventListener("click"'), source.indexOf('E.mealCloseButton.addEventListener')), c);
  return { c, E, store, db, fields, writes, notices, focused: () => focused };
}

test("closing the editor restores a complete draft after relaunch and preserves the input opening gesture", async () => {
  const e = editor(); e.c.openMealDialog("meal", null, { mode: "text" });
  assert.equal(e.focused(), true);
  await e.c.mealDraft.ready;
  e.E.mealNameInput.value = "米饭与蔬菜";
  e.c.mealDraft.photos = [photo]; e.c.mealDraft.clock.setTime("12:35"); e.c.queueMealDraftSave();
  e.E.mealDialog.close(); await drain(e.store);
  const resumed = editor(e.db); resumed.c.openMealDialog(); await resumed.c.mealDraft.ready;
  assert.equal(resumed.E.mealNameInput.value, "米饭与蔬菜");
  assert.equal(resumed.c.mealDraft.photos[0], photo);
  assert.equal(resumed.c.mealDraft.clock.time, "12:35");
  assert.equal(resumed.c.mealDraft.clock.manual, true);
  assert.match(resumed.E.mealDraftStatus.textContent, /已恢复/);
});

test("successful record save clears the draft; a failed record save retains it", async () => {
  for (const fail of [false, true]) {
    const e = editor(); e.c.openMealDialog(); await e.c.mealDraft.ready;
    const key = e.c.mealDraft.key;
    e.E.mealNameInput.value = "晚餐"; e.c.queueMealDraftSave(); await e.c.persistMealDraft(e.c.mealDraft);
    if (fail) e.c.storage.saveMealRecord = async () => { throw new Error("storage full"); };
    await e.c.handleMealSubmit({ preventDefault() {} }); await drain(e.store);
    const saved = await new MealDraftStore(e.db).get(key);
    assert.equal(saved?.name ?? null, fail ? "晚餐" : null);
    assert.equal(e.E.mealDialog.open, fail);
    assert.equal(e.writes.length, fail ? 0 : 1);
  }
});

test("an account switch during draft cleanup cannot inject the saved meal into the new account view", async () => {
  const e = editor(); e.c.openMealDialog(); await e.c.mealDraft.ready;
  e.E.mealNameInput.value = "A's meal"; e.c.queueMealDraftSave();
  e.store.remove = async () => { e.c.storage.sync.generation++; e.c.mealRecords = [{ id: "B's meal" }]; };
  await e.c.handleMealSubmit({ preventDefault() {} });
  assert.equal(e.c.mealRecords.length, 1); assert.equal(e.c.mealRecords[0].id, "B's meal");
  assert.equal(e.notices.length, 0);
});

test("late restoration cannot overwrite a different date or account editor", async () => {
  const e = editor(); let release;
  e.db.get = key => key.includes("account-A") ? new Promise(resolve => { release = resolve; }) : Promise.resolve(null);
  e.c.openMealDialog(); const previous = e.c.mealDraft;
  e.E.mealDialog.close(); e.c.storage.localKey = "account-B"; e.c.storage.sync.generation++;
  e.c.selectedDate = "2026-11-05"; e.c.openMealDialog(); await e.c.mealDraft.ready;
  e.E.mealNameInput.value = "B's draft";
  release(snapshot()); await previous.ready;
  assert.equal(e.E.mealNameInput.value, "B's draft");
  assert.equal(e.c.mealDraft.clock.dateKey, "2026-11-05");
  assert.equal(e.db.rows.size, 0);
});

test("discard requires a second click and removes only this draft, without writing a health record", async () => {
  const e = editor(); e.c.openMealDialog(); await e.c.mealDraft.ready;
  const key = e.c.mealDraft.key, otherKey = mealDraftKey("account-A", "2026-11-05");
  await e.store.save(otherKey, snapshot());
  e.E.mealNameInput.value = "午餐"; e.c.queueMealDraftSave(); await e.c.persistMealDraft(e.c.mealDraft);
  await e.E.mealDraftDiscard.handler();
  assert.equal(e.E.mealDialog.open, true); assert.equal(e.E.mealDraftDiscard.textContent, "确认放弃");
  await e.E.mealDraftDiscard.handler(); await drain(e.store);
  assert.equal(e.E.mealDialog.open, false); assert.equal(await new MealDraftStore(e.db).get(key), null);
  assert.equal((await new MealDraftStore(e.db).get(otherKey)).name, "米饭与蔬菜");
  assert.equal(e.writes.length, 0);
});

test("unchanged record edits leave a new-meal draft untouched, and restored edits retain unfinished nutrient values", async () => {
  const e = editor(), record = { id: "existing", name: "original", recordedAt: "2026-11-06T12:00:00" };
  const newKey = mealDraftKey("account-A", "2026-11-06"), editKey = mealDraftKey("account-A", "2026-11-06", record.id);
  await e.store.save(newKey, snapshot());
  e.c.openMealDialog("meal", record); await e.c.mealDraft.ready; e.E.mealDialog.close(); await drain(e.store);
  assert.equal(e.db.rows.has(editKey), false);
  assert.equal(e.db.rows.get(newKey).name, "米饭与蔬菜");
  await e.store.save(editKey, snapshot()); e.c.openMealDialog("meal", record); await e.c.mealDraft.ready;
  assert.equal(e.c.mealDraft.id, record.id); assert.equal(e.fields.mealKcalInput.value, "");
  assert.equal(e.fields.mealCarbsInput.value, "60"); assert.equal(e.writes.length, 0);
});
