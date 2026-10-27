import { toDateKey, fromDateKey } from "./utils.js";

export const MAX_FRIDGE_ITEMS = 100;
export const FRIDGE_UNITS = ["个", "g", "kg", "ml", "L", "份", "袋", "盒", "瓶", "颗", "根", "把", "片"];
export const FRIDGE_LOCATIONS = { refrigerated: "冷藏", frozen: "冷冻", pantry: "常温", unknown: "未指定" };
export function normalizeFridgeItem(value) {
  if (!value || typeof value !== "object") return null;
  const item = {};
  for (const [key, max, required] of [["id", 128, true], ["name", 60, true], ["note", 160, false], ["expiresOn", 10, false]]) {
    const text = value[key] ?? "";
    if (typeof text !== "string" || text.length > max || (required && !text.trim())) return null;
    item[key] = text.trim();
  }
  if (!/^[A-Za-z0-9_-]+$/.test(item.id)) return null;
  if (item.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(item.expiresOn) || toDateKey(fromDateKey(item.expiresOn)) !== item.expiresOn)) return null;
  const quantity = value.quantity ?? null;
  if (quantity !== null && (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000)) return null;
  item.quantity = quantity === null ? null : Math.round(quantity * 1000) / 1000;
  if (item.quantity !== null && item.quantity <= 0) return null;
  item.unit = value.unit ?? "个";
  item.location = value.location ?? "unknown";
  if (!FRIDGE_UNITS.includes(item.unit) || !Object.hasOwn(FRIDGE_LOCATIONS, item.location)) return null;
  return item;
}
export function normalizeFridgeInventory(value) {
  const result = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [id, raw] of Object.entries(value)) {
    const item = normalizeFridgeItem(raw);
    if (!item || item.id !== id || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) continue;
    result[id] = { ...item, updatedAt: raw.updatedAt, ...(raw.deleted === true ? { deleted: true } : {}) };
  }
  return result;
}
export function mergeFridgeInventory(cloud, local, pending = {}) {
  // Server state wins acknowledged edits; explicit unsent edits survive offline reads.
  return { ...normalizeFridgeInventory(local), ...normalizeFridgeInventory(cloud), ...normalizeFridgeInventory(pending) };
}
export function fridgeItems(inventory) {
  return Object.values(normalizeFridgeInventory(inventory)).filter(item => !item.deleted).sort((a, b) =>
    (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999") || a.name.localeCompare(b.name, "zh-CN"));
}
export const fridgeQuantityLabel = item => item.quantity === null ? "有库存" : `${item.quantity} ${item.unit}`;
export function fridgeExpiry(item, today = toDateKey(new Date())) {
  if (!item.expiresOn) return { kind: "none", label: "未填到期日" };
  const days = Math.round((Date.UTC(...item.expiresOn.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0))) - Date.UTC(...today.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0)))) / 86400000);
  if (days < 0) return { kind: "expired", label: "已过标注日期" };
  if (days === 0) return { kind: "soon", label: "今天到期" };
  if (days === 1) return { kind: "soon", label: "明天到期" };
  return { kind: days <= 3 ? "soon" : "fresh", label: `${item.expiresOn.slice(5).replace("-", "/")} 到期` };
}
export function applyFridgeChange(inventory, { operation, before, after, id, updatedAt }) {
  if (!["create", "update", "delete"].includes(operation)) throw new Error("不支持这项库存操作");
  const all = normalizeFridgeInventory(inventory), current = all[id];
  if (operation === "create" && current?.deleted) throw new Error("这项食材已被移除，请重新添加");
  const fingerprint = item => JSON.stringify(item ? normalizeFridgeItem(item) : null);
  if (operation === "create" && current && !current.deleted) {
    if (fingerprint(current) === fingerprint(after)) return { inventory: all, entry: current };
    throw new Error("这项食材已保存后发生变化，请重新打开");
  }
  if (operation !== "create" && (!current || current.deleted)) {
    if (operation === "delete") return { inventory: all, entry: current || before };
    throw new Error("这项食材已移除，请重新打开");
  }
  if (operation === "update" && fingerprint(current) === fingerprint(after)) return { inventory: all, entry: current };
  if (operation !== "create" && fingerprint(current) !== fingerprint(before)) throw new Error("这项食材已经发生变化，请重新打开后再保存");
  const item = normalizeFridgeItem(operation === "delete" ? current : after);
  if (!item || item.id !== id) throw new Error("食材名称、数量、单位或到期日无效");
  if (operation === "create" && fridgeItems(all).length >= MAX_FRIDGE_ITEMS) throw new Error("最多保存 100 种食材，请先整理冰箱");
  const entry = { ...item, updatedAt, ...(operation === "delete" ? { deleted: true } : {}) };
  all[id] = entry;
  return { inventory: all, entry };
}
