import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFridgeItem, normalizeFridgeInventory, mergeFridgeInventory, fridgeItems, fridgeExpiry, applyFridgeChange } from "../js/fridge.js";
import { buildHealthContext } from "../js/assistant-context.js";
import { buildActionCatalog } from "../js/assistant-actions.js";

const item = { id: "eggs", name: "鸡蛋", quantity: 6, unit: "个", location: "refrigerated", expiresOn: "2026-11-01", note: "" };
const entry = { ...item, updatedAt: "2026-10-27T00:00:00.000Z" };
test("inventory accepts name-only foods and real quantities, rejects malformed values and preserves unknown expiry", () => {
  assert.deepEqual(normalizeFridgeItem({ id: "oats", name: "燕麦" }), { id: "oats", name: "燕麦", quantity: null, unit: "个", location: "unknown", expiresOn: "", note: "" });
  for (const patch of [{ quantity: 0 }, { quantity: -1 }, { quantity: "6" }, { quantity: Infinity }, { quantity: 0.0001 }, { unit: "箱箱" }, { location: "any" }, { expiresOn: "2026-02-30" }, { note: "a".repeat(161) }, { id: "__proto__.bad" }]) assert.equal(normalizeFridgeItem({ ...item, ...patch }), null);
  assert.deepEqual(normalizeFridgeItem({ ...item, extra: "private" }), item);
});
test("expiry ordering and reminders use calendar days and do not infer food safety", () => {
  assert.equal(fridgeExpiry(item, "2026-10-29").kind, "soon");
  assert.equal(fridgeExpiry(item, "2026-11-01").label, "今天到期");
  assert.equal(fridgeExpiry(item, "2026-11-02").kind, "expired");
  assert.equal(fridgeExpiry({ ...item, expiresOn: "" }).kind, "none");
  const list = fridgeItems({ oats: { ...entry, id: "oats", expiresOn: "" }, eggs: entry, removed: { ...entry, id: "removed", deleted: true } });
  assert.deepEqual(list.map(row => row.id), ["eggs", "oats"]);
});
test("per-item merge retains unsent edits and deletion tombstones without losing another device's foods", () => {
  const cloud = { eggs: { ...entry, quantity: 4 }, milk: { ...entry, id: "milk", name: "牛奶" } };
  const pending = { eggs: { ...entry, deleted: true } };
  const merged = mergeFridgeInventory(cloud, { eggs: entry }, pending);
  assert.equal(merged.eggs.deleted, true); assert.equal(fridgeItems(merged).length, 1);
  assert.equal(merged.milk.name, "牛奶");
  assert.equal(Object.keys(normalizeFridgeInventory({ bad: entry })).length, 0);
});
test("inventory updates reject stale cards, enforce capacity and never alter unrelated items", () => {
  const inventory = { eggs: entry };
  const after = { ...item, quantity: 4 };
  const updated = applyFridgeChange(inventory, { operation: "update", before: entry, after, id: item.id, updatedAt: entry.updatedAt });
  assert.equal(updated.entry.quantity, 4); assert.equal(inventory.eggs.quantity, 6);
  assert.throws(() => applyFridgeChange(updated.inventory, { operation: "update", before: entry, after: { ...item, quantity: 2 }, id: item.id, updatedAt: entry.updatedAt }), /发生变化/);
  const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`food${i}`, { ...entry, id: `food${i}` }]));
  assert.throws(() => applyFridgeChange(full, { operation: "create", after: item, id: item.id, updatedAt: entry.updatedAt }), /100/);
});
test("AI sees current inventory independently of historical dates, without IDs or counting stock as eaten", () => {
  const profile = { fridgeInventory: { eggs: entry } };
  const context = buildHealthContext([], { rangeDays: "all", profile, now: new Date("2026-10-27T12:00:00") });
  assert.equal(context.fridgeInventory.entries[0].quantity, 6);
  assert.equal(context.fridgeInventory.entries[0].id, undefined);
  assert.equal(context.todayNutrition.entries, 0);
  assert.equal(buildHealthContext([], { categories: ["water"], profile }).fridgeInventory, undefined);
  const catalog = buildActionCatalog([], {}, profile, "鸡蛋吃了两个，更新冰箱");
  assert.equal(catalog.data.records[0].category, "fridge");
  assert.equal(catalog.references.get(catalog.data.records[0].ref).record.id, "eggs");
});
