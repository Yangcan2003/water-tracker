// ========== 存储抽象层 ==========
// 未登录 → localStorage；已登录 → Firestore + localStorage 缓存
import { LS_KEY, DEFAULT_MEDICINES, DEFAULT_SUPPLEMENTS, DEFAULT_CUPS, DEFAULT_REMINDER, DEFAULT_SETTINGS } from "./config.js";
import { generateLocalId, toDateKey } from "./utils.js";

class StorageManager {
  constructor() {
    this.currentUser = null;
    this.db = null;
  }

  setUser(user, db) {
    this.currentUser = user;
    this.db = db;
  }

  get isCloud() { return !!(this.currentUser && this.db); }

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
      return data;
    } catch (e) {
      console.warn("[Storage] 本地数据损坏，已重置", e);
      return this._emptyData();
    }
  }

  _saveLocal(data) {
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
        medicines: [...DEFAULT_MEDICINES],
        supplements: [...DEFAULT_SUPPLEMENTS],
        avatarType: "default",
        avatarColor: "#168d84",
        avatarUrl: "",
      },
      records: {},
      workoutDays: {},
      cups: [...DEFAULT_CUPS],
      reminder: { ...DEFAULT_REMINDER },
      settings: { ...DEFAULT_SETTINGS },
      meta: { lastSyncedAt: null, pendingSyncCount: 0 },
    };
  }

  _getDayRecords(dateKey) {
    const data = this._loadLocal();
    if (!data.records[dateKey]) {
      data.records[dateKey] = { water: [], medicine: [], supplement: [], toilet: [] };
    }
    return data;
  }

  _setDayRecords(dateKey, records) {
    const data = this._loadLocal();
    data.records[dateKey] = records;
    this._saveLocal(data);
  }

  // ========== Profile ==========
  async getProfile() {
    if (this.isCloud) {
      try {
        const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const snap = await getDoc(doc(this.db, "users", this.currentUser.uid));
        const cloud = snap.data() || {};
        // 合并到本地缓存
        const data = this._loadLocal();
        data.profile = {
          dailyGoal: Number(cloud.dailyGoal) || 2000,
          medicines: Array.isArray(cloud.medicines) ? cloud.medicines : [...DEFAULT_MEDICINES],
          supplements: Array.isArray(cloud.supplements) ? cloud.supplements : [...DEFAULT_SUPPLEMENTS],
          avatarType: cloud.avatarType || "default",
          avatarColor: cloud.avatarColor || "#168d84",
          avatarUrl: cloud.avatarUrl || "",
        };
        this._saveLocal(data);
        return data.profile;
      } catch (e) {
        // 降级到本地
        return this._loadLocal().profile;
      }
    }
    return this._loadLocal().profile;
  }

  async updateProfile(partial) {
    const data = this._loadLocal();
    Object.assign(data.profile, partial);
    this._saveLocal(data);

    if (this.isCloud) {
      try {
        const { setDoc, doc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        await setDoc(doc(this.db, "users", this.currentUser.uid), {
          ...partial, updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) { /* 静默失败 */ }
    }
  }

  // ========== Water Logs ==========
  async getWaterLogs(dateKey) {
    if (this.isCloud) {
      try {
        const { getDocs, query, collection, where } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const snap = await getDocs(query(
          collection(this.db, "users", this.currentUser.uid, "waterLogs"),
          where("logDate", "==", dateKey)
        ));
        return snap.docs.map(d => ({
          id: d.id, ...d.data(),
          recordedAt: d.data().recordedAt?.toDate?.() ?? new Date(),
        })).sort((a, b) => a.recordedAt - b.recordedAt);
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
    const rec = { ...record, id: generateLocalId(), recordedAt: record.recordedAt || new Date() };
    const dateKey = record.logDate || toDateKey(new Date());
    const data = this._getDayRecords(dateKey);
    data.records[dateKey].water.push({ ...rec, recordedAt: rec.recordedAt.toISOString() });
    this._saveLocal(data);

    if (this.isCloud) {
      try {
        const { addDoc, collection } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const ref = await addDoc(collection(this.db, "users", this.currentUser.uid, "waterLogs"), {
          source: record.source, amount: record.amount,
          logDate: dateKey, recordedAt: rec.recordedAt,
        });
        rec.id = ref.id; // 替换为 Firestore ID
        // 更新本地缓存中的 ID
        const d2 = this._loadLocal();
        const arr = d2.records[dateKey]?.water || [];
        const idx = arr.findIndex(r => r.id === rec.id || (r.source === record.source && r.amount === record.amount && Math.abs(new Date(r.recordedAt) - rec.recordedAt) < 2000));
        if (idx >= 0) arr[idx].id = ref.id;
        this._saveLocal(d2);
        return rec;
      } catch (e) { /* 保留本地 ID */ }
    }
    return rec;
  }

  async deleteWaterLog(id) {
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk].water;
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        const [removed] = arr.splice(idx, 1);
        this._saveLocal(data);
        if (this.isCloud && !id.startsWith("local_")) {
          try {
            const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
            await deleteDoc(doc(this.db, "users", this.currentUser.uid, "waterLogs", id));
          } catch (e) { /* 云端删除失败但本地已删 */ }
        }
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
        this._saveLocal(data);
        if (this.isCloud && !id.startsWith("local_")) {
          try {
            const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
            await setDoc(doc(this.db, "users", this.currentUser.uid, "waterLogs", id), { recordedAt: newTime }, { merge: true });
          } catch (e) { /* */ }
        }
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
    };
    return map[type];
  }

  async getLogs(type, dateKey) {
    const cfg = this._typeConfig(type);
    if (this.isCloud) {
      try {
        const { getDocs, query, collection, where } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const snap = await getDocs(query(
          collection(this.db, "users", this.currentUser.uid, cfg.coll),
          where("logDate", "==", dateKey)
        ));
        return snap.docs.map(d => ({
          id: d.id, ...d.data(),
          recordedAt: d.data().recordedAt?.toDate?.() ?? new Date(),
          count: d.data().count ?? (d.data().taken === true ? 1 : 0),
        })).sort((a, b) => a.recordedAt - b.recordedAt);
      } catch (e) {
        const data = this._loadLocal();
        return (data.records[dateKey]?.[cfg.key] || []).map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }));
      }
    }
    const data = this._loadLocal();
    return (data.records[dateKey]?.[cfg.key] || []).map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }));
  }

  async addLog(type, record) {
    const cfg = this._typeConfig(type);
    const rec = { ...record, id: generateLocalId(), recordedAt: record.recordedAt || new Date() };
    const dateKey = record.logDate || toDateKey(new Date());
    const data = this._getDayRecords(dateKey);
    const logEntry = { ...rec, recordedAt: rec.recordedAt.toISOString() };
    data.records[dateKey][cfg.key].push(logEntry);
    this._saveLocal(data);

    if (this.isCloud) {
      try {
        const { addDoc, collection } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const cloudData = {
          logDate: dateKey,
          recordedAt: rec.recordedAt,
        };
        if (type === "toilet") {
          cloudData.type = record.type;
        } else {
          cloudData.name = record.name;
          cloudData.dosage = record.dosage || "";
          cloudData.count = record.count || 1;
        }
        const ref = await addDoc(collection(this.db, "users", this.currentUser.uid, cfg.coll), cloudData);
        rec.id = ref.id;
        // 更新本地缓存 ID
        const d2 = this._loadLocal();
        const arr = d2.records[dateKey]?.[cfg.key] || [];
        const idx = arr.findIndex(r => r.id === rec.id || (r[cfg.nameField] === record[cfg.nameField] && Math.abs(new Date(r.recordedAt) - rec.recordedAt) < 2000));
        if (idx >= 0) arr[idx].id = ref.id;
        this._saveLocal(d2);
        return rec;
      } catch (e) { /* 保留本地 ID */ }
    }
    return rec;
  }

  async deleteLog(type, id) {
    const cfg = this._typeConfig(type);
    const data = this._loadLocal();
    for (const dk of Object.keys(data.records)) {
      const arr = data.records[dk][cfg.key];
      const idx = arr.findIndex(r => r.id === id);
      if (idx >= 0) {
        const [removed] = arr.splice(idx, 1);
        this._saveLocal(data);
        if (this.isCloud && !id.startsWith("local_")) {
          try {
            const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
            await deleteDoc(doc(this.db, "users", this.currentUser.uid, cfg.coll, id));
          } catch (e) { /* */ }
        }
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
        this._saveLocal(data);
        if (this.isCloud && !id.startsWith("local_")) {
          try {
            const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
            await setDoc(doc(this.db, "users", this.currentUser.uid, cfg.coll, id), { count, recordedAt }, { merge: true });
          } catch (e) { /* */ }
        }
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
        this._saveLocal(data);
        if (this.isCloud && !id.startsWith("local_")) {
          try {
            const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
            await setDoc(doc(this.db, "users", this.currentUser.uid, cfg.coll, id), { recordedAt: newTime }, { merge: true });
          } catch (e) { /* */ }
        }
        return true;
      }
    }
    return false;
  }

  // ========== Workout Day ==========
  async getWorkoutDay(dateKey) {
    const data = this._loadLocal();
    if (this.isCloud) {
      try {
        const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const snap = await getDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dateKey));
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
    }
    this._saveLocal(data);

    if (this.isCloud) {
      try {
        const { setDoc, deleteDoc, doc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        if (isWorkout) {
          await setDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dateKey), { isWorkout: true, updatedAt: serverTimestamp() });
        } else {
          await deleteDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dateKey));
        }
      } catch (e) { /* */ }
    }
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
      try {
        const { getDocs, query, collection, where, getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const allQueries = dates.flatMap(dk => [
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "waterLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "medicineLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "supplementLogs"), where("logDate", "==", dk))),
          getDocs(query(collection(this.db, "users", this.currentUser.uid, "toiletLogs"), where("logDate", "==", dk))),
          getDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dk)),
        ]);
        const results = await Promise.all(allQueries);

        return dates.map((dk, i) => {
          const offset = i * 5;
          const waterSnap = results[offset], medSnap = results[offset + 1],
            suppSnap = results[offset + 2], toiletSnap = results[offset + 3],
            workoutSnap = results[offset + 4];
          return {
            dateKey: dk,
            waterTotal: waterSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0),
            waterRecs: waterSnap.docs.map(d => d.data()),
            medRecs: medSnap.docs.map(d => ({ ...d.data(), count: d.data().count ?? (d.data().taken ? 1 : 0) })),
            suppRecs: suppSnap.docs.map(d => ({ ...d.data(), count: d.data().count ?? (d.data().taken ? 1 : 0) })),
            toiletRecs: toiletSnap.docs.map(d => d.data()),
            isWorkout: workoutSnap.exists() && workoutSnap.data().isWorkout === true,
          };
        });
      } catch (e) { /* 降级到本地 */ }
    }
    // 本地模式
    const data = this._loadLocal();
    return dates.map(dk => {
      const day = data.records[dk] || { water: [], medicine: [], supplement: [], toilet: [] };
      const waterTotal = day.water.reduce((s, r) => s + (r.amount || 0), 0);
      const toDate = (r) => ({ ...r, recordedAt: new Date(r.recordedAt) });
      return {
        dateKey: dk,
        waterTotal,
        waterRecs: day.water.map(toDate),
        medRecs: day.medicine.map(toDate),
        suppRecs: day.supplement.map(toDate),
        toiletRecs: day.toilet.map(toDate),
        isWorkout: data.workoutDays[dk] || false,
      };
    });
  }

  // ========== 数据合并 ==========
  hasLocalData() {
    const data = this._loadLocal();
    const dates = Object.keys(data.records);
    return dates.length > 0 && dates.some(dk => {
      const day = data.records[dk];
      return day.water.length > 0 || day.medicine.length > 0 || day.supplement.length > 0 || day.toilet.length > 0;
    });
  }

  async mergeLocalToCloud() {
    if (!this.isCloud) return;
    const data = this._loadLocal();
    const { addDoc, collection, setDoc, doc, getDocs, query, where, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");

    // 上传 profile
    if (data.profile) {
      try {
        await setDoc(doc(this.db, "users", this.currentUser.uid), {
          dailyGoal: data.profile.dailyGoal || 2000,
          medicines: data.profile.medicines || DEFAULT_MEDICINES,
          supplements: data.profile.supplements || DEFAULT_SUPPLEMENTS,
          avatarType: data.profile.avatarType || "default",
          avatarColor: data.profile.avatarColor || "#168d84",
          avatarUrl: data.profile.avatarUrl || "",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) { /* */ }
    }

    // 上传 workout days
    for (const [dk, val] of Object.entries(data.workoutDays || {})) {
      if (val) {
        try {
          await setDoc(doc(this.db, "users", this.currentUser.uid, "workoutLogs", dk), { isWorkout: true, updatedAt: serverTimestamp() });
        } catch (e) { /* */ }
      }
    }

    // 上传记录（逐天逐类型）
    for (const [dk, day] of Object.entries(data.records || {})) {
      // 获取云端已有记录用于去重
      const cloudRecs = {};
      for (const type of ["water", "medicine", "supplement", "toilet"]) {
        const collName = type === "water" ? "waterLogs" : type === "toilet" ? "toiletLogs" : type === "medicine" ? "medicineLogs" : "supplementLogs";
        try {
          const snap = await getDocs(query(collection(this.db, "users", this.currentUser.uid, collName), where("logDate", "==", dk)));
          cloudRecs[type] = snap.docs.map(d => d.data());
        } catch (e) { cloudRecs[type] = []; }
      }

      // 上传 water
      for (const rec of (day.water || [])) {
        const dup = cloudRecs.water.some(cr =>
          cr.source === rec.source && cr.amount === rec.amount &&
          Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await addDoc(collection(this.db, "users", this.currentUser.uid, "waterLogs"), {
              source: rec.source, amount: rec.amount,
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 medicine
      for (const rec of (day.medicine || [])) {
        const dup = cloudRecs.medicine.some(cr =>
          cr.name === rec.name && Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await addDoc(collection(this.db, "users", this.currentUser.uid, "medicineLogs"), {
              name: rec.name, dosage: rec.dosage || "", count: rec.count || 1,
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 supplement
      for (const rec of (day.supplement || [])) {
        const dup = cloudRecs.supplement.some(cr =>
          cr.name === rec.name && Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await addDoc(collection(this.db, "users", this.currentUser.uid, "supplementLogs"), {
              name: rec.name, dosage: rec.dosage || "", count: rec.count || 1,
              logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }

      // 上传 toilet
      for (const rec of (day.toilet || [])) {
        const dup = cloudRecs.toilet.some(cr =>
          cr.type === rec.type && Math.abs(new Date(cr.recordedAt?.toDate?.() ?? 0) - new Date(rec.recordedAt)) < 60000
        );
        if (!dup) {
          try {
            await addDoc(collection(this.db, "users", this.currentUser.uid, "toiletLogs"), {
              type: rec.type, logDate: dk, recordedAt: new Date(rec.recordedAt),
            });
          } catch (e) { /* */ }
        }
      }
    }

    // 标记已同步
    data.meta.lastSyncedAt = new Date().toISOString();
    data.meta.pendingSyncCount = 0;
    this._saveLocal(data);
  }
}

export const storage = new StorageManager();
