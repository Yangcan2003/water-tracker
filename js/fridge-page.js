import { fridgeItems, normalizeFridgeItem, fridgeQuantityLabel, fridgeExpiry, FRIDGE_LOCATIONS, MAX_FRIDGE_ITEMS } from "./fridge.js";
import { esc, generateLocalId } from "./utils.js";

export function createFridgePage({ storage, showToast, onAskAssistant }) {
  const el = id => document.getElementById(id);
  const dialog = el("fridgeDialog"), editor = el("fridgeEditor"), form = el("fridgeForm");
  const list = el("fridgeList"), search = el("fridgeSearch"), message = el("fridgeMessage");
  const save = el("fridgeSave"), remove = el("fridgeRemove");
  let owner = storage.sync.generation, editing = null, editorOwner, busy = false, returnToFridge = false, confirmRemove = false, location = "all";
  const allItems = () => fridgeItems(storage.getCachedFridgeInventory());
  function render() {
    if (owner !== storage.sync.generation) {
      owner = storage.sync.generation; returnToFridge = false; dialog.close(); editor.close();
      search.value = ""; location = "all"; editing = null;
    }
    const items = allItems(), soon = items.filter(item => fridgeExpiry(item).kind === "soon"), expired = items.filter(item => fridgeExpiry(item).kind === "expired");
    const summary = items.length ? `${items.length} 种食材${expired.length ? ` · ${expired.length} 项已过标注日期` : soon.length ? ` · ${soon.length} 项优先吃` : " · 随时用现有食材配餐"}` : "记下家里的食材，让 AI 帮你安排下一餐";
    el("accountFridgeSummary").textContent = el("mealFridgeSummary").textContent = summary;
    el("fridgeCount").textContent = items.length ? `${items.length} 种食材，下一餐从这里开始。` : "把家里有什么，轻轻记下来。";
    el("fridgePriority").hidden = !soon.length && !expired.length;
    el("fridgePriority").textContent = expired.length ? `${expired.length} 项已过标注日期，请核对并整理，配餐时跳过。` : soon.length ? `${soon[0].name}${soon.length > 1 ? `等 ${soon.length} 项` : ""}优先吃 · 按你填写的到期日提醒` : "";
    el("fridgeAdd").disabled = items.length >= MAX_FRIDGE_ITEMS || busy;
    el("fridgePlan").disabled = !items.length || busy;
    el("fridgeFilters").querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.fridgeLocation === location)));
    const query = search.value.trim().toLocaleLowerCase();
    const visible = items.filter(item => (location === "all" || item.location === location) && `${item.name} ${item.note}`.toLocaleLowerCase().includes(query));
    list.innerHTML = visible.length ? visible.map(item => {
      const expiry = fridgeExpiry(item);
      return `<button class="fridge-item" type="button" data-fridge-edit="${esc(item.id)}"><span class="fridge-item-symbol" aria-hidden="true">${item.location === "frozen" ? "❄" : item.location === "pantry" ? "▤" : "◌"}</span><span class="fridge-item-copy"><strong>${esc(item.name)}</strong><small>${FRIDGE_LOCATIONS[item.location]}${item.expiresOn ? ` · <span class="fridge-expiry" data-kind="${expiry.kind}">${esc(expiry.label)}</span>` : " · 到期日未填"}</small>${item.note ? `<small class="fridge-item-note">${esc(item.note)}</small>` : ""}</span><span class="fridge-item-quantity">${esc(fridgeQuantityLabel(item))}<span aria-hidden="true">›</span></span></button>`;
    }).join("") : `<div class="fridge-empty"><span aria-hidden="true">${items.length ? "⌕" : "＋"}</span><h3>${items.length ? "没有找到这项食材" : "冰箱里，有什么？"}</h3><p>${items.length ? "换个关键词，或切换存放位置看看。" : "鸡蛋、蔬菜、冷冻肉和常温主食都能记。<br>先填名称就好，数量和到期日可以以后补。"}</p>${!items.length ? '<button type="button" data-fridge-first>添加第一样食材</button>' : ""}</div>`;
  }
  function open() {
    search.value = ""; location = "all"; render(); dialog.showModal();
    const generation = storage.sync.generation;
    void storage.getProfile().then(() => { if (generation === storage.sync.generation) render(); });
  }
  function openEditor(item = null) {
    if (busy) return;
    editing = item ? { ...item } : null; editorOwner = storage.sync.generation; confirmRemove = false;
    form.reset();
    el("fridgeEditorTitle").textContent = item ? "编辑食材" : "添加食材";
    for (const [id, key, fallback] of [["fridgeName", "name", ""], ["fridgeQuantity", "quantity", ""], ["fridgeUnit", "unit", "个"], ["fridgeLocation", "location", "unknown"], ["fridgeExpires", "expiresOn", ""], ["fridgeNote", "note", ""]]) el(id).value = item?.[key] ?? fallback;
    el("fridgeFoodReference").innerHTML = '<option value="">从常吃食物带入名称（可选）</option>' + (storage.getCachedProfile().foodCatalog || []).map(food => `<option value="${esc(food.name)}">${esc(food.name)}</option>`).join("");
    message.textContent = ""; remove.hidden = !item; remove.textContent = "吃完了 / 移除食材";
    returnToFridge = true; dialog.close(); editor.showModal();
  }
  async function persist(operation, after) {
    if (busy || editorOwner !== storage.sync.generation) return;
    busy = true; save.disabled = remove.disabled = true;
    try {
      await storage.saveFridgeChange({ operation, before: editing, after, id: after?.id || editing.id });
      if (editorOwner !== storage.sync.generation) return;
      editor.close(); showToast(operation === "delete" ? "已移除食材" : "食材已保存", false);
    } catch (error) { if (editorOwner === storage.sync.generation) message.textContent = error.message; }
    finally { busy = false; save.disabled = remove.disabled = false; render(); }
  }
  el("accountFridgeButton").addEventListener("click", open);
  el("mealFridgeButton").addEventListener("click", open);
  el("fridgeAdd").addEventListener("click", () => openEditor());
  search.addEventListener("input", render);
  el("fridgeFilters").addEventListener("click", event => { const button = event.target.closest("[data-fridge-location]"); if (button) { location = button.dataset.fridgeLocation; render(); } });
  list.addEventListener("click", event => {
    if (event.target.closest("[data-fridge-first]")) { openEditor(); return; }
    const button = event.target.closest("[data-fridge-edit]"); if (button) { const item = allItems().find(item => item.id === button.dataset.fridgeEdit); if (item) openEditor(item); }
  });
  el("fridgeFoodReference").addEventListener("change", event => { if (event.target.value) el("fridgeName").value = event.target.value; });
  form.addEventListener("input", () => { confirmRemove = false; remove.textContent = "吃完了 / 移除食材"; message.textContent = ""; });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    const item = normalizeFridgeItem({ id: editing?.id || generateLocalId(), name: el("fridgeName").value, quantity: el("fridgeQuantity").value.trim() ? Number(el("fridgeQuantity").value) : null, unit: el("fridgeUnit").value, location: el("fridgeLocation").value, expiresOn: el("fridgeExpires").value, note: el("fridgeNote").value });
    if (!item) { message.textContent = "请检查名称、数量和到期日；数量未知可以留空。"; return; }
    await persist(editing ? "update" : "create", item);
  });
  remove.addEventListener("click", async () => {
    if (busy || !editing) return;
    if (!confirmRemove) { confirmRemove = true; remove.textContent = "确认移除这项食材"; return; }
    await persist("delete", null);
  });
  editor.addEventListener("close", () => { if (returnToFridge) { returnToFridge = false; render(); dialog.showModal(); } });
  const ask = prompt => { if (onAskAssistant(prompt)) { returnToFridge = false; dialog.close(); } };
  el("fridgeAIAdd").addEventListener("click", () => ask("帮我把这些食材存入“我的冰箱”：\n"));
  el("fridgePlan").addEventListener("click", () => ask("请用我的冰箱当前库存安排下一餐，结合我设置的营养目标和今天已记录的摄入，优先使用临期且未过标注日期的食材。列出菜名、做法、所用食材及数量、还需购买的东西；不清楚忌口、人数或烹饪时间时先问我。只是制定菜单，先不要扣库存或记录已吃。"));
  for (const modal of [dialog, editor]) modal.addEventListener("click", event => { const b = modal.getBoundingClientRect(); if (event.target === modal && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) modal.close(); });
  window.addEventListener("fridge-change", render);
  window.addEventListener("body-measurements-change", render);
  return { render };
}
