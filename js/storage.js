// ========== 存储抽象层 ==========
// 未登录 → localStorage；已登录 → Firestore + localStorage 缓存
import { LS_KEY, DEFAULT_MEDICINES, DEFAULT_SUPPLEMENTS, DEFAULT_CUPS, DEFAULT_REMINDER, DEFAULT_SETTINGS } from "./config.js";
import { generateLocalId, toDateKey } from "./utils.js";
import { SyncTracker } from "./sync-tracker.js";
import { MealPhotoStore } from "./meal-photos.js";
import { normalizeMealNutrition } from "./meal-nutrition.js";
import { normalizeNutritionGoal } from "./nutrition-goals.js";
import { normalizeFoodCatalog } from "./food-catalog.js";
import { MAX_MEAL_PHOTOS, isMealPhoto } from "./meals.js";
import { inHistoryRange } from "./history-range.js";
import { mergeMeasurements, validateMeasurement } from "./body-measurements.js";
import {
  collection as firebaseCollection, deleteDoc as firebaseDeleteDoc, doc,
  getDoc as firebaseGetDoc, getDocs as firebaseGetDocs,
  query as firebaseQuery, queryEqual, serverTimestamp, setDoc as firebaseSetDoc, where, documentId,
} from "firebase/firestore";

const queryPaths = new WeakMap();
const collection = (...args) => {
  const ref = firebaseCollection(...args);
  queryPaths.set(ref, ref.path);
  return ref;
};
const query = (ref, ...constraints) => {
  const result = firebaseQuery(ref, ...constraints);
  queryPaths.set(result, queryPaths.get(ref));
  return result;
};
const labels = { waterLogs: "饮水", medicineLogs: "药物", supplementLogs: "补剂", toiletLogs: "如厕", mealLogs: "三餐", workoutLogs: "训练" };
const requestLabel = path => labels[path?.split("/")[2]] || "账户设置";
const getDoc = ref => storage.sync.run({ key: `read:${ref.path}`, label: requestLabel(ref.path), kind: "read", operation: () => firebaseGetDoc(ref) });
const getDocs = ref => {
  let index = storage.syncQueries.findIndex(previous => queryEqual(previous, ref));
  if (index < 0) index = storage.syncQueries.push(ref) - 1;
  return storage.sync.run({ key: `query:${index}`, label: requestLabel(queryPaths.get(ref)), kind: "read", operation: () => firebaseGetDocs(ref) });
};
const deleteDoc = ref => storage.sync.run({ key: `write:${ref.path}`, label: requestLabel(ref.path), kind: "write", operation: async () => {
  await firebaseDeleteDoc(ref);
  storage.invalidateHistory();
} });
const setDoc = (ref, data, options) => {
  const key = `write:${ref.path}`;
  // Preserve earlier unsent fields when a newer edit targets the same document.
  const previous = storage.sync.failures.get(key)?.request.payload;
  const payload = options?.merge && previous ? { ...previous, ...data } : data;
  return storage.sync.run({ key, label: requestLabel(ref.path), kind: "write", payload, operation: async () => {
    await (options ? firebaseSetDoc(ref, payload, options) : firebaseSetDoc(ref, payload));
    if (labels[ref.path.split("/")[2]]) storage.invalidateHistory();
  } });
};

class StorageManager {
  constructor() {
    this.mealPhotos = new MealPhotoStore();
    this.currentUser = null;
    this.db = null;
    this.sync = new SyncTracker(() => this.notifySyncChange());
    this.syncQueries = [];
    this.syncBatchPending = false;
    this.syncBatchTimeoutMs = 20_000;
    this.recordSyncRequests = new Map();
    this.dayRevisions = new Map();
    this.profileRevision = 0;
    this.historyCache = null;
    this.historyRequest = null;
    this.historyRevision = 0;
    this.historyRanges = new Map();
    this.historyRangeRequests = new Map();
  }

  setUser(user, db) {
    this.historyCache = null;
    this.historyRequest = null;
    this.historyRanges.clear();
    this.historyRangeRequests.clear();
    this.invalidateHistory();
    this.currentUser = user;
    this.db = db;
    this.sync.reset();
    this.syncQueries = [];
    this.syncBatchPending = false;
    this.recordSyncRequests.clear();
    this.dayRevisions.clear();
    this.profileRevision++;
    this._restoreHistoryRanges();
    this._claimLocalBodyMeasurements();
    this.notifySyncChange();
    window.dispatchEvent(new Event("body-measurements-change"));
  }

  get isCloud() { return !!(this.currentUser && this.db); }

  get syncStatus() {
    const hasPendingWrites = this.isCloud && (this.hasLocalData()
      || Object.keys(this._loadLocal().bodyMeasurementPending?.[this.currentUser.uid] || {}).length > 0);
    const state = !this.isCloud ? "local"
      : !navigator.onLine ? "offline"
      : this.sync.failures.size ? "error"
      : this.sync.pending || this.syncBatchPending ? "syncing"
      : hasPendingWrites ? "pending"
      : this.sync.lastSyncedAt ? "synced" : "ready";
    const failures = [...this.sync.failures.values()].map(({ request, error }) => ({
      label: request.label, kind: request.kind, code: error?.code || "unknown",
    }));
    return { state, lastSyncedAt: this.sync.lastSyncedAt, failures, hasPendingWrites };
  }

  notifySyncChange() {
    window.dispatchEvent(new Event("storage-sync-change"));
  }

  async retryFailedRequests() {
    if (!this.isCloud || !navigator.onLine) return;
    const generation = this.sync.generation;
    await this.sync.retry();
    if (generation !== this.sync.generation || !this.isCloud) return;
    // Rebuild batches from the latest durable intents, never replay an expired
    // batch concurrently with the individual document retries it contains.
    if (this.hasLocalData() || this.sync.failures.has(`merge:${this.currentUser.uid}`)) await this.mergeLocalToCloud();
    this.invalidateHistory();
  }

  invalidateHistory() {
    this.historyRevision++;
  }

  // ========== localStorage 读写 ==========
  _loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return this._emptyData();
      const data = JSON.parse(raw);
      // 基本结构校验
      if (!data || typeof data !== "object" || !data.profile || !data.records) {
        console.warn("[Storage] 本地数据格式异常，已重置", data);
        return this._emptyData();
      }
      data.workoutDays ||= {};
      data.workoutDetails ||= {};
      for (const day of Object.values(data.records)) {
        if (!day || typeof day !== "object") continue;
        day.water ||= [];
        day.medicine ||= [];
        day.supplement ||= [];
        day.toilet ||= [];
        day.meal ||= [];
      }
      return data;
    } catch (e) {
      console.warn("[Storage] 本地数据损坏，已重置", e);
      return this._emptyData();
    }
  }

  _saveLocal(data, historyChanged = false) {
    if (historyChanged) this.invalidateHistory();
    try {
      const json = JSON.stringify(data);
      localStorage.setItem(LS_KEY, json);
      return true;
    } catch (e) {
      // quota 超限：尝试清理 90 天前的旧记录
      console.warn("[Storage] 存储空间不足，尝试清理旧数据...");
      const pruned = this._pruneOldRecords(data, 90);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(pruned));
        return true;
      } catch (e2) {
        console.error("[Storage] 清理后仍无法保存，数据可能丢失", e2);
        return false;
      }
    }
  }

  _pruneOldRecords(data, daysToKeep) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    const newRecords = {};
    for (const dk of Object.keys(data.records || {})) {
      if (dk >= cutoffKey) newRecords[dk] = data.records[dk];
    }
    const removed = Object.keys(data.records || {}).length - Object.keys(newRecords).length;
    if (removed > 0) console.warn(`[Storage] 已清理 ${removed} 天旧记录`);
    return { ...data, records: newRecords, meta: { ...data.meta, prunedAt: new Date().toISOString() } };
  }

  _emptyData() {
    return {
      profile: {
        dailyGoal: 2000,
        nutritionGoal: null,
        medicines: [...DEFAULT_MEDICINES],
        supplements: [...DEFAULT_SUPPLEMENTS],
        avatarType: "default",
        avatarColor: "#168d84",
        avatarUrl: "",
      },
      records: {},
      workoutDays: {},
      workoutDetails: {},
      cups: [...DEFAULT_CUPS],
      reminder: { ...DEFAULT_REMINDER },
      settings: { ...DEFAULT_SETTINGS },
      meta: { lastSyncedAt: null, pendingSyncCount: 0 },
      // 待上传标记："profile"、"workout:<日期>"、"<日期>/<类型>" → true。
      // 只有未登录时的写入或云端写入失败才会打标，合并时只处理有标记的部分。
      pendingUpload: {},
    };
  }

  _markPendingUpload(key) {
    try {
      const data = this._loadLocal();
      data.pendingUpload ||= {};
      data.pendingUpload[key] = true;
      this._saveLocal(data);
    } catch { /* 标记丢失最多导致下次全量合并，不影响数据 */ }
  }

  _clearPendingUpload(key) {
    try {
      const data = this._loadLocal();
      if (!data.pendingUpload?.[key]) return;
      delete data.pendingUpload[key];
      this._saveLocal(data);
    } catch { /* 同上 */ }
  }

  _getDayRecords(dateKey) {
    const data = this._loadLocal();
    if (!data.records[dateKey]) {
      data.records[dateKey] = { water: [], medicine: [], supplement: [], toilet: [], meal: [] };
    }
    return data;
  }

  _setDayRecords(dateKey, records) {
    const data = this._loadLocal();
    data.records[dateKey] = records;
    this._saveLocal(data);
  }

  // Commit the record and its upload intent together before acknowledging a tap.
  // Intents are per account/document, so retries survive restarts and rapid edits
  // (including deletion before a create finishes) cannot resurrect old values.
  _commitRecordChange(data, type, dateKey, id, deleted = false) {
    let change;
    if (this.isCloud) {
      data.recordWrites ||= {};
      const writes = data.recordWrites[this.currentUser.uid] ||= {};
      change = { type, dateKey, id, deleted, revision: generateLocalId() };
      change.record = type === "workout"
        ? { ...data.workoutDetails[dateKey], isWorkout: data.workoutDays[dateKey] === true }
        : data.records[dateKey]?.[type]?.find(record => record.id === id);
      writes[`${type}:${id}`] = change;
    } else {
      data.pendingUpload ||= {};
      data.pendingUpload[type === "workout" ? `workout:${dateKey}` : `${dateKey}/${type}`] = true;
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); }
    catch { throw new Error("设备存储空间不足，记录未保存，请释放空间后重试"); }
    this.dayRevisions.set(dateKey, (this.dayRevisions.get(dateKey) || 0) + 1);
    this.invalidateHistory();
    if (change) void this._syncRecordChange(change).catch(() => {});
  }

  _pendingRecordChanges() {
    return Object.values(this._loadLocal().recordWrites?.[this.currentUser?.uid] || {});
  }

  _overlayRecordChanges(type, dateKey, records) {
    const rows = new Map(records.map(record => [record.id, record]));
    const data = this._loadLocal();
    // Guest/legacy records can still be uploading while startup reads run.
    if (data.pendingUpload?.[`${dateKey}/${type}`]) {
      for (const record of data.records[dateKey]?.[type] || []) {
        if (!rows.has(record.id)) rows.set(record.id, { ...record, recordedAt: new Date(record.recordedAt) });
      }
    }
    for (const change of this._pendingRecordChanges()) {
      if (change.type !== type || change.dateKey !== dateKey) continue;
      if (change.deleted) rows.delete(change.id);
      else rows.set(change.id, { ...change.record, recordedAt: new Date(change.record.recordedAt) });
    }
    return [...rows.values()];
  }

  _syncRecordChange(change) {
    const uid = this.currentUser.uid, generation = this.sync.generation;
    const collectionName = change.type === "water" ? "waterLogs"
      : change.type === "workout" ? "workoutLogs" : this._typeConfig(change.type).coll;
    const target = doc(this.db, "users", uid, collectionName, change.id);
    const key = `write:${target.path}`;
    const previous = this.recordSyncRequests.get(key);
    if (previous?.revision === change.revision) return previous.promise;
    const promise = this.sync.run({ key, label: requestLabel(target.path), kind: "write", operation: async ({ signal }) => {
      // Order requests to the same document; unrelated taps sync independently.
      if (previous) await previous.promise.catch(() => {});
      if (signal.aborted) throw signal.reason;
      if (generation !== this.sync.generation) return;
      if (change.deleted) await firebaseDeleteDoc(target);
      else {
        const record = change.record;
        const payload = change.type === "workout" ? { ...record, updatedAt: serverTimestamp() }
          : { logDate: change.dateKey, recordedAt: new Date(record.recordedAt) };
        if (change.type === "water") Object.assign(payload, { source: record.source, amount: record.amount });
        else if (change.type === "toilet") payload.type = record.type;
        else if (change.type === "meal") Object.assign(payload, { mealType: record.mealType, name: record.name || "", note: record.note || "", nutrition: normalizeMealNutrition(record.nutrition), photos: await this.readMealPhotos(record) });
        else if (change.type !== "workout") Object.assign(payload, { name: record.name, dosage: record.dosage || "", count: record.count ?? 1, ...(record.targetCount ? { targetCount: record.targetCount } : {}) });
        if (generation !== this.sync.generation) return;
        if (signal.aborted) throw signal.reason;
        await firebaseSetDoc(target, payload, { merge: change.type !== "workout" });
      }
      if (generation !== this.sync.generation) return;
      const data = this._loadLocal();
      const writes = data.recordWrites?.[uid];
      if (writes?.[`${change.type}:${change.id}`]?.revision === change.revision) {
        delete writes[`${change.type}:${change.id}`];
        if (change.type === "meal" && !change.deleted) {
          const row = data.records[change.dateKey]?.meal?.find(record => record.id === change.id);
          if (row) row.mealPending = false;
        }
        this._saveLocal(data);
      }
      this.invalidateHistory();
    } });
    this.recordSyncRequests.set(key, { revision: change.revision, promise });
    const cleanup = () => {
      if (this.recordSyncRequests.get(key)?.promise === promise) this.recordSyncRequests.delete(key);
    };
    promise.then(cleanup, cleanup);
    return promise;
  }

  // ========== Profile ==========
  async getProfile() {
    if (this.isCloud) {
      const generation = this.sync.generation;
      const revision = this.profileRevision;
      const uid = this.currentUser.uid;
      try {
        const snap = await getDoc(doc(this.db, "users", uid));
        if (generation !== this.sync.generation) return this._loadLocal().profile;
        const cloud = snap.data() || {};
        // 合并到本地缓存
        const data = this._loadLocal();
        if (revision !== this.profileRevision) return data.profile;
        const pendingProfile = data.pendingUpload?.profile ? data.profile : {};
        data.profile = {
          dailyGoal: Number(cloud.dailyGoal) || 2000,
          medicines: Array.isArray(cloud.medicines) ? cloud.medicines : [...DEFAULT_MEDICINES],
          supplements: Array.isArray(cloud.supplements) ? cloud.supplements : [...DEFAULT_SUPPLEMENTS],
          avatarType: cloud.avatarType || "default",
          avatarColor: cloud.avatarColor || "#168d84",
          avatarUrl: cloud.avatarUrl || "",
          ...pendingProfile,
          nutritionGoal: normalizeNutritionGoal(pendingProfile.nutritionGoal ?? cloud.nutritionGoal),
          ...(Array.isArray(pendingProfile.foodCatalog ?? cloud.foodCatalog) ? { foodCatalog: normalizeFoodCatalog(pendingProfile.foodCatalog ?? cloud.foodCatalog) } : {}),
        };
        data.bodyMeasurements ||= {};
        data.bodyMeasurements[uid] = mergeMeasurements(cloud.bodyMeasurements, data.bodyMeasurements[uid]);
        this._saveLocal(data);
        window.dispatchEvent(new Event("body-measurements-change"));
        void this._syncBodyMeasurements().catch(() => {});
        return data.profile;
      } catch (e) {
        // 降级到本地
        if (generation === this.sync.generation) void this._syncBodyMeasurements().catch(() => {});
        return this._loadLocal().profile;
      }
    }
    return this._loadLocal().profile;
  }

  // 同步返回本地缓存的 profile，用于在云端数据返回前先渲染界面，避免闪烁。
  getCachedProfile() {
    return this._loadLocal().profile;
  }

  getCachedDay(dateKey) {
    const data = this._loadLocal();
    const day = data.records[dateKey] || {};
    const result = Object.fromEntries(["water", "medicine", "supplement", "toilet", "meal"].map(type => [type,
      (day[type] || []).map(record => ({ ...record, recordedAt: new Date(record.recordedAt) }))]));
    result.workout = { ...data.workoutDetails[dateKey], isWorkout: data.workoutDays[dateKey] === true };
    return result;
  }

  async getCachedMealLogs(dateKey) {
    return Promise.all(this.getCachedDay(dateKey).meal.map(async record => ({
      ...record, photos: await this.readMealPhotos(record).catch(() => []),
    })));
  }

  async updateProfile(partial) {
    const data = this._loadLocal();
    Object.assign(data.profile, partial);
    this._saveLocal(data);
    this.profileRevision++;

    if (this.isCloud) {
      try {
        await setDoc(doc(this.db, "users", this.currentUser.uid), {
          ...partial, updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        // 静默失败，等待下次合并上传
        this._markPendingUpload("profile");
      }
    } else {
      this._markPendingUpload("profile");
    }
  }

  // Body history is kept outside daily logs, so old-record cleanup never removes it.
  getCachedBodyMeasurements() {
    return this._loadLocal().bodyMeasurements?.[this.currentUser?.uid || "__local__"] || {};
  }

  _claimLocalBodyMeasurements() {
    if (!this.currentUser) return;
    const data = this._loadLocal();
    const guest = data.bodyMeasurements?.__local__;
    if (!guest || !Object.keys(guest).length) return;
    const uid = this.currentUser.uid;
    data.bodyMeasurements[uid] = mergeMeasurements(data.bodyMeasurements[uid], guest);
    data.bodyMeasurementPending ||= {};
    data.bodyMeasurementPending[uid] = mergeMeasurements(data.bodyMeasurementPending[uid], guest);
    delete data.bodyMeasurements.__local__;
    delete data.bodyMeasurementPending.__local__;
    this._saveLocal(data);
  }

  async addBodyMeasurement(input) {
    const values = validateMeasurement(input);
    const timestamp = new Date().toISOString();
    const entry = { ...values, id: generateLocalId(), createdAt: timestamp, updatedAt: timestamp };
    this._saveBodyMeasurement(entry);
    return entry;
  }

  async deleteBodyMeasurement(id) {
    const entry = this.getCachedBodyMeasurements()[id];
    if (!entry || entry.deleted) return;
    this._saveBodyMeasurement({ ...entry, deleted: true, updatedAt: new Date().toISOString() });
  }

  _saveBodyMeasurement(entry) {
    const scope = this.currentUser?.uid || "__local__";
    const data = this._loadLocal();
    data.bodyMeasurements ||= {};
    data.bodyMeasurementPending ||= {};
    data.bodyMeasurements[scope] = { ...data.bodyMeasurements[scope], [entry.id]: entry };
    data.bodyMeasurementPending[scope] = { ...data.bodyMeasurementPending[scope], [entry.id]: entry };
    if (!this._saveLocal(data)) throw new Error("设备存储空间不足，记录未保存，请释放空间后重试");
    window.dispatchEvent(new Event("body-measurements-change"));
    void this._syncBodyMeasurements().catch(() => {});
  }

  async _syncBodyMeasurements() {
    if (!this.isCloud) return;
    const uid = this.currentUser.uid, cloudDb = this.db, generation = this.sync.generation;
    const pending = { ...this._loadLocal().bodyMeasurementPending?.[uid] };
    if (!Object.keys(pending).length) return;
    // A separate request key keeps profile updates from clearing a body-history failure.
    await this.sync.run({ key: `body-measurements:${uid}`, label: "身体档案", kind: "write", operation: async () => {
      await firebaseSetDoc(doc(cloudDb, "users", uid), { bodyMeasurements: pending }, { merge: true });
      if (generation !== this.sync.generation) return;
      const data = this._loadLocal();
      for (const [id, sent] of Object.entries(pending)) {
        const current = data.bodyMeasurementPending?.[uid]?.[id];
        if (current?.updatedAt === sent.updatedAt && !!current.deleted === !!sent.deleted) delete data.bodyMeasurementPending[uid][id];
      }
      this._saveLocal(data);
    } });
  }

  // ========== Water Logs ==========
  async getWaterLogs(dateKey) {
    if (this.isCloud) {
      const generation = this.sync.generation;
      const revision = this.dayRevisions.get(dateKey);
      try {
        const snap = await getDocs(query(
          collection(this.db, "users", this.currentUser.uid, "waterLogs"),
          where("logDate", "==", dateKey)
        ));
        if (generation !== this.sync.generation) return [];
        if (revision !== this.dayRevisions.get(dateKey)) return this.getCachedDay(dateKey).water;
        const rows = this._overlayRecordChanges("water", dateKey, snap.docs.map(d => ({
          id: d.id, ...d.data(),
          recordedAt: new Date(d.data().recordedAt?.toDate?.() ?? d.data().recordedAt ?? Date.now()),
        }))).sort((a, b) => a.recordedAt - b.recordedAt);
        const data = this._getDayRecords(dateKey);
        data.records[dateKey].water = rows.map(row => ({ ...row, recordedAt: row.recordedAt.toISOString() }));
        this._saveLocal(data);
        return rows;
      } catch (e) {
        // 降级到本地
        const data = this._loadLocal();
        return (data.records[dateKey]?.water || []).map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }));
      }
    }
    const data = this._loadLocal();
    return (data.records[dateKey]?.water || []).map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }));
  }

  async addWaterLog(record) {
    const target = this.isCloud ? doc(collection(this.db, "users", this.currentUser.uid, "waterLogs")) : null;
    const rec = { ...record, id: target?.id || generateLocalId(), recordedAt: record.recordedAt || new Date() };
    const dateKey = record.logDate || toDateKey(new Date());
    const data = this._getDayRecords(dateKey);
    data.records[dateKey].water.push({ ...rec, recordedAt: rec.recordedAt.toISOString() });
    this._commitRecordChange(data, "water", dateKey, rec.id);
    return rec;
  }

  async deleteWaterLog(id) {
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk].water;
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        const [removed] = arr.splice(idx, 1);
        this._commitRecordChange(data, "water", dk, id, true);
        return removed;
      }
    }
    return null;
  }

  async updateWaterLogTime(id, newTime) {
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk].water;
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        arr[idx].recordedAt = newTime.toISOString();
        this._commitRecordChange(data, "water", dk, id);
        return true;
      }
    }
    return false;
  }

  // ========== Medicine / Supplement / Toilet Logs (通用模式) ==========
  _typeConfig(type) {
    const map = {
      medicine: { coll: "medicineLogs", key: "medicine", nameField: "name" },
      supplement: { coll: "supplementLogs", key: "supplement", nameField: "name" },
      toilet: { coll: "toiletLogs", key: "toilet", nameField: "type" },
      meal: { coll: "mealLogs", key: "meal", nameField: "name" },
    };
    return map[type];
  }

  async getLogs(type, dateKey) {
    if (type === "meal") return this.getMealLogs(dateKey);
    const cfg = this._typeConfig(type);
    if (this.isCloud) {
      const generation = this.sync.generation;
      const revision = this.dayRevisions.get(dateKey);
      try {
        const snap = await getDocs(query(
          collection(this.db, "users", this.currentUser.uid, cfg.coll),
          where("logDate", "==", dateKey)
        ));
        if (generation !== this.sync.generation) return [];
        if (revision !== this.dayRevisions.get(dateKey)) return this.getCachedDay(dateKey)[type];
        const rows = this._overlayRecordChanges(type, dateKey, snap.docs.map(d => ({
          id: d.id, ...d.data(),
          recordedAt: new Date(d.data().recordedAt?.toDate?.() ?? d.data().recordedAt ?? Date.now()),
          count: d.data().count ?? (d.data().taken === true ? 1 : 0),
        }))).sort((a, b) => a.recordedAt - b.recordedAt);
        const data = this._getDayRecords(dateKey);
        data.records[dateKey][cfg.key] = rows.map(row => ({ ...row, recordedAt: row.recordedAt.toISOString() }));
        this._saveLocal(data);
        return rows;
      } catch (e) {
        const data = this._loadLocal();
        return (data.records[dateKey]?.[cfg.key] || []).map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }));
      }
    }
    const data = this._loadLocal();
    return (data.records[dateKey]?.[cfg.key] || []).map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }));
  }

  async addLog(type, record) {
    if (type === "meal") return this.saveMealRecord(record);
    const cfg = this._typeConfig(type);
    const target = this.isCloud ? doc(collection(this.db, "users", this.currentUser.uid, cfg.coll)) : null;
    const rec = { ...record, id: target?.id || generateLocalId(), recordedAt: record.recordedAt || new Date() };
    const dateKey = record.logDate || toDateKey(new Date());
    const data = this._getDayRecords(dateKey);
    const logEntry = { ...rec, recordedAt: rec.recordedAt.toISOString() };
    data.records[dateKey][cfg.key].push(logEntry);
    this._commitRecordChange(data, type, dateKey, rec.id);
    return rec;
  }

  // Meals keep only small photo references in localStorage; cloud documents carry
  // compressed photos so the same record can be opened on another device.
  async readMealPhotos(record) {
    return record.photos || await this.mealPhotos.get(record.photoIds || []);
  }

  _saveMealLocal(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); }
    catch { throw new Error("设备存储空间不足，饮食记录未保存，请释放空间后重试"); }
    this.invalidateHistory();
  }

  async getMealLogs(dateKey) {
    const generation = this.sync.generation;
    const revision = this.dayRevisions.get(dateKey);
    if (this.isCloud && navigator.onLine) {
      try {
        const snap = await getDocs(query(collection(this.db, "users", this.currentUser.uid, "mealLogs"), where("logDate", "==", dateKey)));
        const remote = await Promise.all(snap.docs.map(async snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          const photos = (record.photos || []).filter(isMealPhoto);
          return { ...record, id: snapshot.id, logDate: dateKey,
            recordedAt: new Date(record.recordedAt?.toDate?.() ?? record.recordedAt).toISOString(),
            photoIds: await this.mealPhotos.put(photos), photos: undefined };
        }));
        if (generation !== this.sync.generation) return [];
        if (revision !== this.dayRevisions.get(dateKey)) return this.getCachedMealLogs(dateKey);
        const data = this._getDayRecords(dateKey);
        // An incomplete offline Firestore snapshot must never erase local photos.
        const pending = data.records[dateKey].meal.filter(record => record.mealPending || snap.metadata?.fromCache);
        data.records[dateKey].meal = this._overlayRecordChanges("meal", dateKey,
          [...remote.filter(record => !pending.some(local => local.id === record.id)), ...pending])
          .map(record => ({ ...record, recordedAt: new Date(record.recordedAt).toISOString() }));
        this._saveMealLocal(data);
      } catch (error) { console.warn("[Storage] 饮食读取使用本地记录:", error.message); }
    }
    const data = this._loadLocal();
    return Promise.all((data.records[dateKey]?.meal || []).map(async record => ({
      ...record, recordedAt: new Date(record.recordedAt), photos: await this.readMealPhotos(record),
    })));
  }

  async saveMealRecord(record, id = null) {
    const photos = record.photos || [];
    if (photos.length > MAX_MEAL_PHOTOS || !photos.every(isMealPhoto)) throw new Error("食物图片无效，请重新添加");
    if (!record.name?.trim() && !record.note?.trim() && !photos.length) throw new Error("请添加食物照片或填写文字记录");
    const generation = this.sync.generation;
    const cloudDb = this.db, uid = this.currentUser?.uid;
    const target = this.isCloud ? (id ? doc(cloudDb, "users", uid, "mealLogs", id) : doc(collection(cloudDb, "users", uid, "mealLogs"))) : null;
    const photoIds = await this.mealPhotos.put(photos);
    if (generation !== this.sync.generation) throw new Error("账户已切换，请重新保存");
    const dateKey = record.logDate || toDateKey(record.recordedAt || new Date());
    if (record.nutrition != null && !normalizeMealNutrition(record.nutrition)) throw new Error("营养数值无效，请检查后重试");
    const rec = { ...record, nutrition: normalizeMealNutrition(record.nutrition), id: id || target?.id || generateLocalId(), logDate: dateKey,
      recordedAt: record.recordedAt || new Date(), photoIds, photos: undefined,
      mealPending: true, mealRevision: generateLocalId() };
    const data = this._getDayRecords(dateKey);
    const rows = data.records[dateKey].meal;
    const index = rows.findIndex(item => item.id === rec.id);
    const localRecord = { ...rec, recordedAt: rec.recordedAt.toISOString() };
    if (index < 0) rows.push(localRecord); else rows[index] = localRecord;
    this._commitRecordChange(data, "meal", dateKey, rec.id);
    return { ...rec, photos };
  }

  _markMealSynced(dateKey, id, revision) {
    const data = this._loadLocal();
    const rec = data.records[dateKey]?.meal?.find(record => record.id === id);
    if (rec?.mealRevision !== revision) return;
    rec.mealPending = false;
    this._saveMealLocal(data);
  }

  async deleteLog(type, id) {
    const cfg = this._typeConfig(type);
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk][cfg.key];
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        const [removed] = arr.splice(idx, 1);
        this._commitRecordChange(data, type, dk, id, true);
        return removed;
      }
    }
    return null;
  }

  async updateLogCount(type, id, count, recordedAt) {
    const cfg = this._typeConfig(type);
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk][cfg.key];
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        arr[idx].count = count;
        arr[idx].recordedAt = recordedAt.toISOString();
        this._commitRecordChange(data, type, dk, id);
        return true;
      }
    }
    return false;
  }

  async updateLogTime(type, id, newTime) {
    const cfg = this._typeConfig(type);
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk][cfg.key];
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        arr[idx].recordedAt = newTime.toISOString();
        this._commitRecordChange(data, type, dk, id);
        return true;
      }
    }
    return false;
  }

  // ========== Workout Day ==========
  async getWorkoutDay(dateKey) {
    let data = this._loadLocal();
    if (this.isCloud) {
      const generation = this.sync.generation;
      try {
        const snap = await getDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dateKey));
        data = this._loadLocal();
        if (generation !== this.sync.generation) return data.workoutDays[dateKey] || false;
        if (this._pendingRecordChanges().some(change => change.type === "workout" && change.dateKey === dateKey)) return data.workoutDays[dateKey] || false;
        const val = snap.exists() && snap.data().isWorkout === true;
        data.workoutDays[dateKey] = val;
        this._saveLocal(data);
        return val;
      } catch (e) {
        return data.workoutDays[dateKey] || false;
      }
    }
    return data.workoutDays[dateKey] || false;
  }

  async setWorkoutDay(dateKey, isWorkout) {
    const data = this._loadLocal();
    if (isWorkout) {
      data.workoutDays[dateKey] = true;
    } else {
      delete data.workoutDays[dateKey];
      delete data.workoutDetails[dateKey];
    }
    this._commitRecordChange(data, "workout", dateKey, dateKey, !isWorkout);
  }

  async getWorkoutDetail(dateKey) {
    let data = this._loadLocal();
    if (this.isCloud) {
      const generation = this.sync.generation;
      const revision = this.dayRevisions.get(dateKey);
      try {
        const snap = await getDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dateKey));
        data = this._loadLocal();
        if (generation !== this.sync.generation) return { isWorkout: data.workoutDays[dateKey] === true, ...(data.workoutDetails[dateKey] || {}) };
        if (revision !== this.dayRevisions.get(dateKey) || data.pendingUpload?.[`workout:${dateKey}`]) return this.getCachedDay(dateKey).workout;
        if (this._pendingRecordChanges().some(change => change.type === "workout" && change.dateKey === dateKey)) return { isWorkout: data.workoutDays[dateKey] === true, ...(data.workoutDetails[dateKey] || {}) };
        const detail = snap.exists() ? snap.data() : {};
        data.workoutDays[dateKey] = detail.isWorkout === true;
        delete data.workoutDetails[dateKey];
        if (detail.activity || detail.focus || detail.duration || detail.note) {
          data.workoutDetails[dateKey] = Object.fromEntries(
            ["activity", "focus", "duration", "intensity", "note"].filter(key => detail[key] !== undefined).map(key => [key, detail[key]])
          );
        }
        this._saveLocal(data);
        return { isWorkout: detail.isWorkout === true, ...(data.workoutDetails[dateKey] || {}) };
      } catch (e) { /* 使用本地缓存 */ }
    }
    return { isWorkout: data.workoutDays[dateKey] === true, ...(data.workoutDetails[dateKey] || {}) };
  }

  async saveWorkoutMark(dateKey, activity) {
    if (!["练肩日", "练背日", "练胸日", "休息日"].includes(activity)) throw new Error("请选择训练部位或休息日");
    const data = this._loadLocal();
    data.workoutDays[dateKey] = activity !== "休息日";
    data.workoutDetails[dateKey] = { activity };
    this._commitRecordChange(data, "workout", dateKey, dateKey);
    return { isWorkout: data.workoutDays[dateKey], activity };
  }

  async saveWorkoutDetail(dateKey, detail) {
    const data = this._loadLocal();
    data.workoutDays[dateKey] = true;
    data.workoutDetails[dateKey] = {
      activity: detail.activity || "",
      focus: detail.focus || "",
      duration: Number(detail.duration) || 0,
      intensity: detail.intensity || "适中",
      note: detail.note || "",
    };
    this._commitRecordChange(data, "workout", dateKey, dateKey);
    return { isWorkout: true, ...data.workoutDetails[dateKey] };
  }

  // ========== Items (medicine/supplement 定义) ==========
  async getItems(type) {
    const profile = await this.getProfile();
    const key = type === "medicine" ? "medicines" : "supplements";
    return profile[key] || (type === "medicine" ? [...DEFAULT_MEDICINES] : [...DEFAULT_SUPPLEMENTS]);
  }

  async saveItems(type, items) {
    const key = type === "medicine" ? "medicines" : "supplements";
    await this.updateProfile({ [key]: items });
  }

  // ========== Cups (自定义水杯) ==========
  async getCups() {
    const data = this._loadLocal();
    return (Array.isArray(data.cups) && data.cups.length > 0) ? data.cups : [...DEFAULT_CUPS];
  }

  async saveCups(cups) {
    const data = this._loadLocal();
    data.cups = cups;
    this._saveLocal(data);
  }

  // ========== Settings (音效/震动/语言) ==========
  async getSettings() {
    const data = this._loadLocal();
    return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  }

  async updateSettings(partial) {
    const data = this._loadLocal();
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), ...partial };
    this._saveLocal(data);
  }

  // ========== Reminder (饮水提醒) ==========
  async getReminder() {
    const data = this._loadLocal();
    return { ...DEFAULT_REMINDER, ...(data.reminder || {}) };
  }

  async updateReminder(partial) {
    const data = this._loadLocal();
    data.reminder = { ...DEFAULT_REMINDER, ...(data.reminder || {}), ...partial };
    this._saveLocal(data);
  }

  // ========== History (multi-day) ==========
  async getHistory(dates) {
    if (this.isCloud) {
      const generation = this.sync.generation;
      try {
        const allQueries = dates.flatMap(dk => [
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "waterLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "medicineLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "supplementLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "toiletLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "mealLogs"), where("logDate", "==", dk))).catch(() => ({ docs: [] })),
          getDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dk)),
        ]);
        const results = await Promise.all(allQueries);
        if (generation !== this.sync.generation) return this.getHistory(dates);

        const localData = this._loadLocal();
        return dates.map((dk, i) => {
          const offset = i * 6;
          const waterSnap = results[offset], medSnap = results[offset + 1],
            suppSnap = results[offset + 2], toiletSnap = results[offset + 3],
            mealSnap = results[offset + 4], workoutSnap = results[offset + 5];
          const rows = (type, snap) => this._overlayRecordChanges(type, dk,
            snap.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id })));
          const waterRecs = rows("water", waterSnap);
          const workoutPending = this._pendingRecordChanges().some(change => change.type === "workout" && change.dateKey === dk);
          return {
            dateKey: dk,
            waterTotal: waterRecs.reduce((sum, record) => sum + (Number(record.amount) || 0), 0),
            waterRecs,
            medRecs: rows("medicine", medSnap).map(record => ({ ...record, count: record.count ?? (record.taken ? 1 : 0) })),
            suppRecs: rows("supplement", suppSnap).map(record => ({ ...record, count: record.count ?? (record.taken ? 1 : 0) })),
            toiletRecs: rows("toilet", toiletSnap),
            mealRecs: this._overlayRecordChanges("meal", dk, mealSnap.docs.length
              ? mealSnap.docs.map(d => ({ ...d.data(), id: d.id, photos: undefined }))
              : (localData.records[dk]?.meal || []).map(record => ({ ...record, recordedAt: new Date(record.recordedAt) }))),
            isWorkout: workoutPending ? localData.workoutDays[dk] === true : workoutSnap.exists() && workoutSnap.data().isWorkout === true,
            workoutDetail: workoutPending ? localData.workoutDetails[dk] || {} : workoutSnap.exists() ? workoutSnap.data() : {},
          };
        });
      } catch (e) { /* 降级到本地 */ }
    }
    // 本地模式
    const data = this._loadLocal();
    return dates.map(dk => {
      const day = data.records[dk] || { water: [], medicine: [], supplement: [], toilet: [], meal: [] };
      const waterTotal = day.water.reduce((s, r) => s + (r.amount || 0), 0);
      const toDate = (r) => ({ ...r, recordedAt: new Date(r.recordedAt) });
      return {
        dateKey: dk,
        waterTotal,
        waterRecs: day.water.map(toDate),
        medRecs: day.medicine.map(toDate),
        suppRecs: day.supplement.map(toDate),
        toiletRecs: day.toilet.map(toDate),
        mealRecs: (day.meal || []).map(toDate),
        isWorkout: data.workoutDays[dk] || false,
        workoutDetail: data.workoutDetails?.[dk] || {},
      };
    });
  }

  /** 获取所有实际存在记录的日期，按日期从新到旧排列。 */
  getCachedHistory() {
    return this.historyCache?.days ?? this._getLocalHistory();
  }

  getCachedHistoryRange(range) {
    // Local records can be only a small subset of cloud history. Never present them
    // as a complete cloud result while the first range query is still running.
    if (!this.isCloud) return this._getLocalHistory().filter(day => inHistoryRange(day.dateKey, range));
    return this.historyRanges.get(`${range.startDate}:${range.endDate}`)?.days ?? null;
  }

  _restoreHistoryRanges() {
    if (!this.isCloud) return;
    try {
      const snapshots = JSON.parse(localStorage.getItem(`${LS_KEY}:history:${this.currentUser.uid}`) || "[]", (key, value) => {
        if (key !== "recordedAt") return value;
        const date = new Date(typeof value?.seconds === "number" ? value.seconds * 1000 : value);
        return Number.isNaN(date.getTime()) ? value : date;
      });
      for (const [key, snapshot] of snapshots) {
        if (Array.isArray(snapshot?.days)) this.historyRanges.set(key, { ...snapshot, revision: -1 });
      }
    } catch { /* A missing or damaged snapshot must not block live history. */ }
  }

  _persistHistoryRanges() {
    if (!this.isCloud) return;
    try {
      const snapshots = [...this.historyRanges].sort((a, b) => b[1].loadedAt - a[1].loadedAt).slice(0, 6);
      localStorage.setItem(`${LS_KEY}:history:${this.currentUser.uid}`, JSON.stringify(snapshots));
    } catch { /* Quota failures leave the in-memory snapshot available. */ }
  }

  async getHistoryRange(range) {
    const key = `${range.startDate}:${range.endDate}`;
    const revision = this.historyRevision, generation = this.sync.generation;
    const cached = this.historyRanges.get(key);
    if (this.isCloud && !navigator.onLine) {
      if (cached) return cached.days;
      throw Object.assign(new Error("本月记录尚未缓存，请联网后重试"), { code: "unavailable" });
    }
    if (cached?.revision === revision && Date.now() - cached.loadedAt < 60_000) return cached.days;
    const pending = this.historyRangeRequests.get(key);
    if (pending?.revision === revision) return pending.promise;

    const promise = this._fetchAllHistory(range).then(days => {
      if (generation !== this.sync.generation || revision !== this.historyRevision) return this.getHistoryRange(range);
      this.historyRanges.set(key, { days, revision, loadedAt: Date.now() });
      this._persistHistoryRanges();
      return days;
    }).finally(() => {
      if (this.historyRangeRequests.get(key)?.promise === promise) this.historyRangeRequests.delete(key);
    });
    this.historyRangeRequests.set(key, { revision, promise });
    return promise;
  }

  async getAllHistory() {
    const revision = this.historyRevision;
    const generation = this.sync.generation;
    // Reopening history within a minute reuses the complete result, including an empty list.
    if (this.historyCache?.revision === revision && Date.now() - this.historyCache.loadedAt < 60_000) {
      return this.historyCache.days;
    }
    if (this.historyRequest?.revision === revision) return this.historyRequest.promise;

    const promise = this._fetchAllHistory().then(days => {
      // A write or account change during the read must not restore an obsolete snapshot.
      if (generation !== this.sync.generation || revision !== this.historyRevision) return this.getAllHistory();
      this.historyCache = { days, revision, loadedAt: Date.now() };
      return days;
    }).finally(() => {
      if (this.historyRequest?.promise === promise) this.historyRequest = null;
    });
    this.historyRequest = { revision, promise };
    return promise;
  }

  async _fetchAllHistory(range = null) {
    if (this.isCloud) {
      try {
        const uid = this.currentUser.uid;
        const readCollection = name => {
          const ref = collection(this.db, "users", uid, name);
          if (!range) return getDocs(ref);
          const field = name === "workoutLogs" ? documentId() : "logDate";
          return getDocs(query(ref, where(field, ">=", range.startDate), where(field, "<=", range.endDate)));
        };
        const [waterSnap, medSnap, suppSnap, toiletSnap, mealSnap, workoutSnap] = await Promise.all([
          readCollection("waterLogs"),
          readCollection("medicineLogs"),
          readCollection("supplementLogs"),
          readCollection("toiletLogs"),
          readCollection("mealLogs").catch(() => ({ docs: [] })),
          readCollection("workoutLogs"),
        ]);
        if (range && [waterSnap, medSnap, suppSnap, toiletSnap, mealSnap, workoutSnap].some(snapshot => snapshot.metadata?.fromCache)) {
          throw Object.assign(new Error("等待完整的云端记录"), { code: "unavailable" });
        }

        const days = new Map();
        const ensureDay = (dateKey) => {
          if (!dateKey) return null;
          if (!days.has(dateKey)) {
            days.set(dateKey, {
              dateKey, waterTotal: 0, waterRecs: [], medRecs: [],
              suppRecs: [], toiletRecs: [], mealRecs: [], isWorkout: false, workoutDetail: {},
            });
          }
          return days.get(dateKey);
        };

        waterSnap.docs.forEach(snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          const day = ensureDay(record.logDate);
          if (!day) return;
          day.waterRecs.push(record);
          day.waterTotal += Number(record.amount) || 0;
        });
        medSnap.docs.forEach(snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          const day = ensureDay(record.logDate);
          if (day) day.medRecs.push({ ...record, count: record.count ?? (record.taken ? 1 : 0) });
        });
        suppSnap.docs.forEach(snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          const day = ensureDay(record.logDate);
          if (day) day.suppRecs.push({ ...record, count: record.count ?? (record.taken ? 1 : 0) });
        });
        toiletSnap.docs.forEach(snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          const day = ensureDay(record.logDate);
          if (day) day.toiletRecs.push(record);
        });
        mealSnap.docs.forEach(snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          const day = ensureDay(record.logDate);
          if (day) day.mealRecs.push({ ...record, id: snapshot.id, photos: undefined });
        });
        workoutSnap.docs.forEach(snapshot => {
          const record = { ...snapshot.data(), id: snapshot.id };
          if (record.isWorkout === true || record.activity === "休息日") {
            const day = ensureDay(snapshot.id);
            day.isWorkout = record.isWorkout === true;
            day.workoutDetail = record;
          }
        });

        // 新功能先写入本地缓存；即使线上规则尚未更新，历史页也不会丢失这些记录。
        const localData = this._loadLocal();
        Object.entries(localData.records || {}).forEach(([dateKey, records]) => {
          if (!inHistoryRange(dateKey, range)) return;
          for (const record of (records.meal || [])) {
            const day = ensureDay(dateKey);
            const index = day.mealRecs.findIndex(item => item.id === record.id || (item.mealType === record.mealType && item.name === record.name && new Date(item.recordedAt?.toDate?.() ?? item.recordedAt).getTime() === new Date(record.recordedAt).getTime()));
            const local = { ...record, photos: undefined, recordedAt: new Date(record.recordedAt) };
            if (index < 0) day.mealRecs.push(local);
            else if (record.mealPending) day.mealRecs[index] = local;
          }
        });

        // A server read may finish before a background upload. Overlay durable
        // local intents, including tombstones, rather than hiding the latest tap.
        const historyKeys = { water: "waterRecs", medicine: "medRecs", supplement: "suppRecs", toilet: "toiletRecs", meal: "mealRecs" };
        for (const change of this._pendingRecordChanges()) {
          if (!inHistoryRange(change.dateKey, range)) continue;
          const day = ensureDay(change.dateKey);
          if (change.type === "workout") {
            day.isWorkout = !change.deleted && change.record.isWorkout === true;
            day.workoutDetail = change.deleted ? {} : change.record;
          } else {
            const key = historyKeys[change.type];
            day[key] = day[key].filter(record => record.id !== change.id);
            if (!change.deleted) day[key].push({ ...change.record, photos: undefined, recordedAt: new Date(change.record.recordedAt) });
            if (change.type === "water") day.waterTotal = day.waterRecs.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
          }
        }
        return [...days.values()].filter(day => day.isWorkout || day.workoutDetail?.activity === "休息日" || Object.values(historyKeys).some(key => day[key].length))
          .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
      } catch (e) {
        if (range) throw e; // Keep the complete cached range; do not replace it with partial local data.
        console.warn("[Storage] 云端全部历史记录加载失败，使用本地缓存", e);
      }
    }

    return this._getLocalHistory().filter(day => inHistoryRange(day.dateKey, range));
  }

  _getLocalHistory() {
    const data = this._loadLocal();
    const dateKeys = new Set(Object.keys(data.records || {}));
    Object.entries(data.workoutDays || {}).forEach(([dateKey, isWorkout]) => {
      if (isWorkout) dateKeys.add(dateKey);
    });
    Object.keys(data.workoutDetails || {}).forEach(dateKey => dateKeys.add(dateKey));
    const toDate = (record) => ({ ...record, recordedAt: new Date(record.recordedAt) });

    return [...dateKeys]
      .sort((a, b) => b.localeCompare(a))
      .map(dateKey => {
        const day = data.records[dateKey] || { water: [], medicine: [], supplement: [], toilet: [], meal: [] };
        return {
          dateKey,
          waterTotal: day.water.reduce((sum, record) => sum + (Number(record.amount) || 0), 0),
          waterRecs: day.water.map(toDate),
          medRecs: day.medicine.map(toDate),
          suppRecs: day.supplement.map(toDate),
          toiletRecs: day.toilet.map(toDate),
          mealRecs: (day.meal || []).map(toDate),
          isWorkout: data.workoutDays[dateKey] || false,
          workoutDetail: data.workoutDetails?.[dateKey] || {},
        };
      })
      .filter(day => day.isWorkout || day.workoutDetail?.activity === "休息日" || day.waterRecs.length || day.medRecs.length || day.suppRecs.length || day.toiletRecs.length || day.mealRecs.length);
  }

  // ========== 数据合并 ==========
  hasLocalData() {
    const data = this._loadLocal();
    if (this._pendingRecordChanges().length) return true;
    // 有脏标记后只需合并标记过的数据；升级前的旧数据没有标记，按原逻辑全量检查一次
    if (data.pendingUpload) return Object.keys(data.pendingUpload).length > 0;
    const dates = Object.keys(data.records);
    return dates.length > 0 && dates.some(dk => {
      const day = data.records[dk];
      return day.water.length > 0 || day.medicine.length > 0 || day.supplement.length > 0 || day.toilet.length > 0 || (day.meal || []).length > 0;
    });
  }

  async mergeLocalToCloud() {
    if (!this.isCloud) return;
    if (this.syncBatchPending) return;
    const generation = this.sync.generation;
    this.syncBatchPending = true;
    this.notifySyncChange();
    try {
      await this.sync.run({ key: `merge:${this.currentUser.uid}`, label: "记录上传", kind: "write",
        timeoutMs: this.syncBatchTimeoutMs, recoverOnLateSuccess: false, retry: false, operation: async ({ signal }) => {
          const deadline = Date.now() + this.syncBatchTimeoutMs;
          await Promise.allSettled(this._pendingRecordChanges().map(change => this._syncRecordChange(change)));
          if (signal.aborted || !this._canContinueSyncBatch(generation, deadline)) return;
          await this._mergeLocalToCloud(deadline);
        } });
    } catch { /* Keep upload intents and expose the request failure for retry. */
    } finally {
      if (generation === this.sync.generation) {
        this.invalidateHistory();
        this.syncBatchPending = false;
        this.notifySyncChange();
      }
    }
  }

  _canContinueSyncBatch(generation, deadline) {
    return generation === this.sync.generation && navigator.onLine && Date.now() < deadline
      && ![...this.sync.failures.values()].some(({ request, error }) => !request.key.startsWith("merge:")
        && /(?:deadline-exceeded|unavailable|unauthenticated)$/.test(error?.code || ""));
  }

  async _mergeLocalToCloud(deadline = Date.now() + 20_000) {
    const data = this._loadLocal();
    const cloudDb = this.db, uid = this.currentUser.uid;
    const generation = this.sync.generation;
    // The current batch's previous timeout is cleared only after this retry
    // returns. It must not prevent successfully acknowledged records clearing.
    const hasFailures = () => [...this.sync.failures.keys()].some(key => key !== `merge:${uid}`);
    // 脏标记模式：只合并标记过的部分；旧数据（无标记）全量合并一次后启用标记
    const pending = data.pendingUpload || null;

    // 上传 profile
    if (data.profile && (!pending || pending["profile"])) {
      try {
        await setDoc(doc(cloudDb, "users", uid), {
          dailyGoal: data.profile.dailyGoal || 2000,
          ...(normalizeNutritionGoal(data.profile.nutritionGoal) ? { nutritionGoal: normalizeNutritionGoal(data.profile.nutritionGoal) } : {}),
          ...(Array.isArray(data.profile.foodCatalog) ? { foodCatalog: normalizeFoodCatalog(data.profile.foodCatalog) } : {}),
          medicines: data.profile.medicines || DEFAULT_MEDICINES,
          supplements: data.profile.supplements || DEFAULT_SUPPLEMENTS,
          avatarType: data.profile.avatarType || "default",
          avatarColor: data.profile.avatarColor || "#168d84",
          avatarUrl: data.profile.avatarUrl || "",
          updatedAt: serverTimestamp(),
        }, { merge: true });
        this._clearPendingUpload("profile");
      } catch (e) { /* */ }
    }

    // 上传 workout days
    for (const [dk, val] of Object.entries(data.workoutDays || {})) {
      if (!this._canContinueSyncBatch(generation, deadline)) return;
      if (pending && !pending[`workout:${dk}`]) continue;
      if (val || data.workoutDetails?.[dk]?.activity === "休息日") {
        try {
          await setDoc(doc(cloudDb, "users", uid, "workoutLogs", dk), {
            isWorkout: val === true,
            ...(data.workoutDetails?.[dk] || {}),
            updatedAt: serverTimestamp(),
          }, { merge: false });
          this._clearPendingUpload(`workout:${dk}`);
        } catch (e) { /* */ }
      } else if (pending) {
        this._clearPendingUpload(`workout:${dk}`);
      }
    }

    // 上传记录（逐天逐类型）
    const RECORD_TYPES = ["water", "medicine", "supplement", "toilet", "meal"];
    for (const [dk, day] of Object.entries(data.records || {})) {
      if (!this._canContinueSyncBatch(generation, deadline)) return;
      if (pending && !RECORD_TYPES.some(t => pending[`${dk}/${t}`])) continue;
      // 获取云端已有记录用于去重
      const cloudRecs = {};
      for (const type of RECORD_TYPES) {
        if (!this._canContinueSyncBatch(generation, deadline)) return;
        if (pending && !pending[`${dk}/${type}`]) continue;
        if (!day[type]?.length) continue;
        const collName = type === "water" ? "waterLogs" : type === "toilet" ? "toiletLogs" : type === "medicine" ? "medicineLogs" : type === "meal" ? "mealLogs" : "supplementLogs";
        try {
          const snap = await getDocs(query(collection(cloudDb, "users", uid, collName), where("logDate", "==", dk)));
          cloudRecs[type] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        } catch (e) { cloudRecs[type] = null; } // Never upload if deduplication could not be checked.
      }

      // 上传 water
      for (const rec of (cloudRecs.water ? day.water || [] : [])) {
        if (!this._canContinueSyncBatch(generation, deadline)) return;
        const dup = cloudRecs.water.some(cr =>
          cr.source === rec.source && cr.amount === rec.amount &&
          Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await setDoc(doc(cloudDb, "users", uid, "waterLogs", rec.id), {
              source: rec.source, amount: rec.amount,
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 medicine
      for (const rec of (cloudRecs.medicine ? day.medicine || [] : [])) {
        if (!this._canContinueSyncBatch(generation, deadline)) return;
        const dup = cloudRecs.medicine.some(cr =>
          cr.name === rec.name && Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await setDoc(doc(cloudDb, "users", uid, "medicineLogs", rec.id), {
              name: rec.name, dosage: rec.dosage || "", count: rec.count || 1,
              ...(rec.targetCount ? { targetCount: rec.targetCount } : {}),
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 supplement
      for (const rec of (cloudRecs.supplement ? day.supplement || [] : [])) {
        if (!this._canContinueSyncBatch(generation, deadline)) return;
        const dup = cloudRecs.supplement.some(cr =>
          cr.name === rec.name && Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await setDoc(doc(cloudDb, "users", uid, "supplementLogs", rec.id), {
              name: rec.name, dosage: rec.dosage || "", count: rec.count || 1,
              ...(rec.targetCount ? { targetCount: rec.targetCount } : {}),
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 toilet
      for (const rec of (cloudRecs.toilet ? day.toilet || [] : [])) {
        if (!this._canContinueSyncBatch(generation, deadline)) return;
        const dup = cloudRecs.toilet.some(cr =>
          cr.type === rec.type && Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await setDoc(doc(cloudDb, "users", uid, "toiletLogs", rec.id), {
              type: rec.type, logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 meals
      for (const rec of (cloudRecs.meal ? day.meal || [] : [])) {
        if (!this._canContinueSyncBatch(generation, deadline)) return;
        const dup = cloudRecs.meal.some(cr => cr.id === rec.id || (
          cr.mealType === rec.mealType && cr.name === rec.name &&
          Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        ));
        if (!dup || rec.mealPending) {
          try {
            const photos = await this.readMealPhotos(rec);
            if (!this._canContinueSyncBatch(generation, deadline)) return;
            await setDoc(doc(cloudDb, "users", uid, "mealLogs", rec.id), {
              mealType: rec.mealType, name: rec.name || "", note: rec.note || "",
              photos, nutrition: normalizeMealNutrition(rec.nutrition),
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            }, { merge: true });
            if (generation === this.sync.generation && rec.mealRevision) this._markMealSynced(dk, rec.id, rec.mealRevision);
          } catch (e) { /* */ }
        }
      }

      // 保留未确认上传的数据；成功的重试可清除标记。
      if (pending && !hasFailures()) {
        for (const type of RECORD_TYPES) {
          if (pending[`${dk}/${type}`]) this._clearPendingUpload(`${dk}/${type}`);
        }
      }
    }

    // 标记已同步
    if (!this._canContinueSyncBatch(generation, deadline)) return;
    if (!hasFailures()) {
      // Reload here: the user may have added records while the upload was running.
      const latest = this._loadLocal();
      latest.meta.lastSyncedAt = new Date().toISOString();
      latest.meta.pendingSyncCount = 0;
      // 旧数据首次全量合并成功后启用脏标记；有失败时保持无标记状态，下次继续全量重试
      if (!pending) latest.pendingUpload = {};
      this._saveLocal(latest);
    }
  }
}

export const storage = new StorageManager();
