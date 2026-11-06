import { isMealPhoto, MAX_MEAL_PHOTOS } from "./meals.js";
import { normalizeMealNutrition, NUTRITION_FIELDS } from "./meal-nutrition.js";
import { toDateKey, fromDateKey } from "./utils.js";

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
export const mealDraftKey = (owner, date, id = null, repeatId = null) => JSON.stringify([owner, date, id ? "edit" : repeatId ? "repeat" : "new", id || repeatId || null]);

export function normalizeMealDraft(value) {
  if (!value || value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey) || toDateKey(fromDateKey(value.dateKey)) !== value.dateKey) return null;
  return { version: 1, dateKey: value.dateKey, name: typeof value.name === "string" ? value.name.slice(0, 400) : "",
    photos: (Array.isArray(value.photos) ? value.photos : []).filter(isMealPhoto).slice(0, MAX_MEAL_PHOTOS),
    nutrition: normalizeMealNutrition(value.nutrition),
    nutritionValues: Object.fromEntries(NUTRITION_FIELDS.map(field => [field.key, typeof value.nutritionValues?.[field.key] === "string" ? value.nutritionValues[field.key].slice(0, 24) : ""])),
    time: typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : "",
    captured: value.captured === true, manual: value.manual === true };
}

class DraftDatabase {
  async open() {
    if (!this.database) this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open("health-tracker-meal-drafts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.database = null; };
        resolve(request.result);
      };
      request.onblocked = () => reject(new Error("请关闭其他 App 页面后重试草稿暂存"));
      request.onerror = () => reject(new Error("暂时无法读取饮食草稿"));
    }).catch(error => { this.database = null; throw error; });
    return this.database;
  }
  async run(mode, action) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", mode);
      const request = action(transaction.objectStore("drafts"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error("草稿未能保存到本机，请检查设备存储空间"));
    });
  }
  get(key) { return this.run("readonly", store => store.get(key)); }
  put(key, value) { return this.run("readwrite", store => store.put(value, key)); }
  delete(key) { return this.run("readwrite", store => store.delete(key)); }
}

// Drafts stay on this device, separate from saved records, backups and cloud sync.
// Serialize writes and deletion so a slow autosave cannot resurrect a discarded draft.
export class MealDraftStore {
  constructor(backend = new DraftDatabase()) { this.backend = backend; this.cache = new Map(); this.tails = new Map(); this.temporary = new Set(); }
  remember(key, value) { const saved = clone(value); this.cache.set(key, saved); this.temporary.add(key); return saved; }
  isTemporary(key) { return this.temporary.has(key); }
  async get(key) {
    if (this.cache.has(key)) return clone(this.cache.get(key));
    const value = normalizeMealDraft(await this.backend.get(key));
    if (!this.cache.has(key)) { this.remember(key, value); this.temporary.delete(key); }
    return clone(this.cache.get(key));
  }
  enqueue(key, action) {
    const operation = (this.tails.get(key) || Promise.resolve()).catch(() => {}).then(action);
    this.tails.set(key, operation);
    void operation.catch(() => {}).finally(() => { if (this.tails.get(key) === operation) this.tails.delete(key); });
    return operation;
  }
  save(key, snapshot) {
    const value = normalizeMealDraft(snapshot);
    if (!value) return Promise.reject(new Error("草稿内容无效"));
    const cached = this.remember(key, value);
    return this.enqueue(key, () => this.backend.put(key, value)).then(() => { if (this.cache.get(key) === cached) this.temporary.delete(key); });
  }
  remove(key) {
    this.remember(key, null);
    return this.enqueue(key, () => this.backend.delete(key)).then(() => { if (this.cache.get(key) === null) this.temporary.delete(key); });
  }
}
