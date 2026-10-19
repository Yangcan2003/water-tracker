import { EXTRA_NUTRIENTS, FOOD_NUTRIENTS, MAX_FAVORITE_FOODS, normalizeFavoriteFood, normalizeFoodCatalog, foodServingLabel, foodEnergyToKcal, foodEnergyFromKcal } from "./food-catalog.js";
import { esc, generateLocalId } from "./utils.js";

export function createFoodCatalogPage({ storage, showToast }) {
  const el = id => document.getElementById(id);
  const library = el("foodCatalogDialog"), editor = el("foodCatalogEditor"), form = el("foodCatalogForm");
  const list = el("foodCatalogList"), search = el("foodCatalogSearch"), message = el("foodCatalogMessage");
  const remove = el("foodCatalogDelete"), save = el("foodCatalogSave");
  let owner = storage.sync.generation, editorGeneration, editingId = null, returnToLibrary = false, busy = false, confirmDelete = false;
  let energyUnit = "kcal", energyKcal = null;
  const foods = () => normalizeFoodCatalog(storage.getCachedProfile().foodCatalog);
  function render() {
    if (owner !== storage.sync.generation) {
      owner = storage.sync.generation; returnToLibrary = false; library.close(); editor.close();
    }
    const all = foods(), query = search.value.trim().toLocaleLowerCase();
    el("accountFoodsSummary").textContent = all.length ? `已保存 ${all.length} 种 · AI 识别时优先参考匹配食物` : "保存常吃食物的份量与营养，供 AI 识别参考";
    el("foodCatalogCount").textContent = `${all.length} / ${MAX_FAVORITE_FOODS} 种`;
    el("mealFoodReferenceHint").textContent = all.length ? `识别时可参考 ${all.length} 种常吃食物的营养数据，匹配后按实际份量换算。` : "可在“我的 · 健康管理 · 常吃食物”保存营养数据，供识别参考。";
    el("foodCatalogAdd").disabled = all.length >= MAX_FAVORITE_FOODS || busy;
    const visible = all.filter(food => `${food.name} ${food.aliases} ${food.note}`.toLocaleLowerCase().includes(query));
    list.innerHTML = visible.length ? visible.map(food => `<button class="food-catalog-item" type="button" data-food-edit="${esc(food.id)}"><span class="food-item-heading"><strong>${esc(food.name)}</strong><span>编辑 ›</span></span><span class="food-item-serving">${esc(foodServingLabel(food))}${food.aliases ? ` · ${esc(food.aliases)}` : ""}</span><span class="food-item-macros"><b>${food.kcal} kcal</b><span>碳水 ${food.carbsG} g</span><span>蛋白质 ${food.proteinG} g</span><span>脂肪 ${food.fatG} g</span></span>${food.note ? `<span class="food-item-serving">${esc(food.note)}</span>` : ""}</button>`).join("") : `<div class="food-catalog-empty"><strong>${all.length ? "没有匹配的食物" : "添加你常吃的食物"}</strong><p>${all.length ? "试试食物名称、品牌或别名。" : "照着包装营养表填写，或记录固定做法的食物。<br>保存份量与营养数值，识别时就有依据。"}</p></div>`;
  }
  function renderEnergy(updateValue = false) {
    const input = el("foodValuekcal"), hint = el("foodEnergyConversion");
    el("foodEnergyValueUnit").textContent = energyUnit;
    el("foodEnergyUnit").querySelectorAll("input").forEach(radio => { radio.checked = radio.value === energyUnit; });
    input.max = String(foodEnergyFromKcal(FOOD_NUTRIENTS[0].max, energyUnit));
    if (updateValue) input.value = energyKcal === null ? "" : Math.round(foodEnergyFromKcal(energyKcal, energyUnit) * 10) / 10;
    hint.hidden = energyUnit !== "kJ" || energyKcal === null;
    hint.textContent = hint.hidden ? "" : `约 ${energyKcal.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} kcal，保存时自动换算。`;
  }
  el("foodValuekcal").addEventListener("input", () => {
    const raw = el("foodValuekcal").value.trim();
    energyKcal = raw ? foodEnergyToKcal(Number(raw), energyUnit) : null;
    renderEnergy();
  });
  el("foodEnergyUnit").addEventListener("change", event => {
    if (!event.target.matches('input[name="foodEnergyUnit"]')) return;
    energyUnit = event.target.value;
    // Convert from the unrounded draft to avoid drift from repeated toggles.
    renderEnergy(true);
  });
  function openEditor(food = null) {
    if (busy) return;
    editorGeneration = storage.sync.generation;
    editingId = food?.id || null; confirmDelete = false;
    form.reset();
    for (const [id, key, fallback] of [["foodName", "name", ""], ["foodAliases", "aliases", ""], ["foodAmount", "servingAmount", 100], ["foodUnit", "servingUnit", "g"], ["foodNote", "note", ""]]) el(id).value = food?.[key] ?? fallback;
    for (const field of FOOD_NUTRIENTS) el(`foodValue${field.key}`).value = food?.[field.key] ?? "";
    el("foodExtraNutrition").open = EXTRA_NUTRIENTS.some(field => food?.[field.key] != null);
    energyUnit = "kcal"; energyKcal = food?.kcal ?? null;
    renderEnergy(true);
    el("foodCatalogEditorTitle").textContent = food ? "编辑常吃食物" : "添加常吃食物";
    message.textContent = ""; remove.hidden = !food; remove.textContent = "删除这项食物";
    returnToLibrary = true; library.close(); editor.showModal();
  }
  el("accountFoodsButton").addEventListener("click", () => { search.value = ""; render(); library.showModal(); });
  el("foodCatalogAdd").addEventListener("click", () => openEditor());
  search.addEventListener("input", render);
  list.addEventListener("click", event => { const button = event.target.closest("[data-food-edit]"); if (button) { const food = foods().find(value => value.id === button.dataset.foodEdit); if (food) openEditor(food); } });
  form.addEventListener("input", () => { message.textContent = ""; confirmDelete = false; remove.textContent = "删除这项食物"; });
  el("foodUnit").addEventListener("change", () => { if (!["g", "ml"].includes(el("foodUnit").value) && el("foodAmount").value === "100") el("foodAmount").value = "1"; });
  async function persist(next) {
    if (editorGeneration !== storage.sync.generation) { returnToLibrary = false; editor.close(); return; }
    busy = true; save.disabled = remove.disabled = true;
    try {
      await storage.updateProfile({ foodCatalog: next });
      if (editorGeneration !== storage.sync.generation) return;
      render(); editor.close(); showToast("常吃食物已更新", false);
    } catch (error) { if (editorGeneration === storage.sync.generation) message.textContent = error.message; }
    finally { busy = false; save.disabled = remove.disabled = false; render(); }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    const food = normalizeFavoriteFood({ id: editingId || generateLocalId(), name: el("foodName").value, aliases: el("foodAliases").value,
      servingAmount: Number(el("foodAmount").value), servingUnit: el("foodUnit").value, note: el("foodNote").value,
      ...Object.fromEntries(FOOD_NUTRIENTS.map(field => [field.key, field.key === "kcal" ? energyKcal : el(`foodValue${field.key}`).value.trim() ? Number(el(`foodValue${field.key}`).value) : null])) });
    if (!food) { message.textContent = "请检查名称、份量和营养数值；更多营养可留空，饱和脂肪和糖不能超过对应总量。"; return; }
    const all = foods(), index = all.findIndex(value => value.id === editingId);
    if (index < 0 && all.length >= MAX_FAVORITE_FOODS) { message.textContent = "最多保存 50 种常吃食物，请先整理已有食物。"; return; }
    if (index < 0) all.push(food); else all[index] = food;
    await persist(all);
  });
  remove.addEventListener("click", async () => {
    if (busy || !editingId) return;
    if (!confirmDelete) { confirmDelete = true; remove.textContent = "确认删除这项食物"; return; }
    await persist(foods().filter(food => food.id !== editingId));
  });
  editor.addEventListener("close", () => { if (returnToLibrary) { returnToLibrary = false; render(); library.showModal(); } });
  for (const dialog of [library, editor]) dialog.addEventListener("click", event => { const b = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) dialog.close(); });
  window.addEventListener("body-measurements-change", render);
  return { render, references: foods };
}
