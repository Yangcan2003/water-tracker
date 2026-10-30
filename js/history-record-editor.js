import { fromDateKey, toTimeValue } from "./utils.js";
import { validWaterAmount } from "./water-values.js";
import { recordISO } from "./data-backup.js";

export function createHistoryRecordEditor({ storage, showToast, onChanged, onMeal, onWorkout }) {
  const el = id => document.getElementById(`historyRecord${id}`);
  const dialog = document.getElementById("historyRecordEditor");
  const labels = { water: "饮水", medicine: "药物", supplement: "补剂", toilet: "如厕" };
  let draft = null, busy = false, opening = false;
  async function open(category, id, date) {
    if (busy || opening) return;
    opening = true;
    const generation = storage.sync.generation;
    try {
      if (category === "workout") { onWorkout(date); return; }
      const rows = category === "water" ? await storage.getWaterLogs(date) : await storage.getLogs(category, date);
      if (generation !== storage.sync.generation) return;
      const row = rows.find(row => row.id === id);
      if (!row) throw new Error("这条记录已变化，请刷新历史后重试");
      if (category === "meal") { await onMeal(row, date); return; }
      draft = { category, id, date, row, generation, deleteConfirm: false };
      el("Title").textContent = `编辑${labels[category]}记录`;
      el("Date").textContent = date;
      el("Time").value = toTimeValue(new Date(recordISO(row.recordedAt)));
      el("Name").value = row.name || row.source || "";
      el("Amount").value = row.amount ?? ""; el("Count").value = row.count ?? (row.taken ? 1 : 0);
      el("Dosage").value = row.dosage || ""; el("Toilet").value = row.type || "small";
      for (const [field, visible] of [["Name", category !== "toilet"], ["Amount", category === "water"], ["Count", ["medicine", "supplement"].includes(category)], ["Dosage", ["medicine", "supplement"].includes(category)], ["Toilet", category === "toilet"]]) {
        el(`${field}Field`).hidden = !visible; el(field).disabled = !visible;
        el(field).required = visible && field !== "Dosage";
      }
      el("Message").textContent = ""; el("Delete").textContent = "删除记录"; dialog.showModal();
    } catch (error) { if (generation === storage.sync.generation) showToast(error.message, false); }
    finally { opening = false; }
  }
  async function save(deleted) {
    if (!draft || busy) return;
    const current = draft;
    if (current.generation !== storage.sync.generation) { dialog.close(); return; }
    busy = true; el("Save").disabled = el("Delete").disabled = true;
    try {
      const time = el("Time").value;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("请选择有效时间");
      const [h, m] = time.split(":").map(Number), recordedAt = fromDateKey(current.date);
      recordedAt.setHours(h, m, 0, 0);
      const row = { ...current.row, recordedAt, logDate: current.date };
      if (!deleted && current.category === "water") {
        const amount = Number(el("Amount").value);
        if (!validWaterAmount(amount)) throw new Error("饮水容量须为 10～5000 ml 的整数");
        Object.assign(row, { source: el("Name").value.trim(), amount });
      } else if (!deleted && current.category === "toilet") row.type = el("Toilet").value;
      else if (!deleted) {
        const count = Number(el("Count").value);
        if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error("请输入有效服用次数");
        Object.assign(row, { name: el("Name").value.trim(), dosage: el("Dosage").value.trim(), count });
      }
      if (!deleted && current.category !== "toilet" && !(row.name || row.source)?.trim()) throw new Error("请填写名称");
      await storage.writeAssistantRecord(current.category, current.date, row, deleted, current.id);
      if (current.generation !== storage.sync.generation) return;
      dialog.close(); await onChanged(); showToast(deleted ? "记录已删除" : "历史记录已修改", false);
    } catch (error) { if (current.generation === storage.sync.generation) el("Message").textContent = error.message; }
    finally { busy = false; el("Save").disabled = el("Delete").disabled = false; }
  }
  el("Form").addEventListener("submit", event => { event.preventDefault(); if (el("Form").reportValidity()) void save(false); });
  el("Delete").addEventListener("click", () => {
    if (!draft || busy) return;
    if (!draft.deleteConfirm) { draft.deleteConfirm = true; el("Delete").textContent = "再点一次确认删除"; return; }
    void save(true);
  });
  el("Close").addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { draft = null; });
  return { open };
}
