import { DEFAULT_NUTRITION_RATIOS, GOAL_MACROS, normalizeNutritionGoal, nutritionTargets, nutritionGoalProgress } from "./nutrition-goals.js";
import { latestMeasurements } from "./body-measurements.js";

const format = value => value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export function createNutritionGoalsPage({ storage, showToast }) {
  const el = id => document.getElementById(id);
  const dialog = el("nutritionGoalDialog"), form = el("nutritionGoalForm");
  const weight = el("nutritionGoalWeight"), message = el("nutritionGoalMessage"), save = el("nutritionGoalSave");
  let totals = {}, loading = false, saving = false, owner = storage.sync.generation, editorGeneration;
  const currentGoal = () => normalizeNutritionGoal(storage.getCachedProfile().nutritionGoal);
  const latestWeight = () => latestMeasurements(storage.getCachedBodyMeasurements()).weight;
  const readDraft = () => normalizeNutritionGoal({ weightKg: weight.value.trim() ? Number(weight.value) : null,
    ratios: Object.fromEntries(GOAL_MACROS.map(({ key, id }) => [key, el(`nutritionGoal${id}`).value.trim() ? Number(el(`nutritionGoal${id}`).value) : null])) });
  function preview() {
    const targets = nutritionTargets(readDraft());
    for (const { key, id } of GOAL_MACROS) el(`nutritionPreview${id}`).textContent = format(targets?.[key]);
  }
  function render(nextTotals, nextLoading = false) {
    if (owner !== storage.sync.generation) {
      owner = storage.sync.generation;
      totals = {}; loading = false; dialog.close();
    }
    if (nextTotals) { totals = nextTotals; loading = nextLoading; }
    const goal = currentGoal(), targets = nutritionTargets(goal);
    el("accountNutritionContext").textContent = goal ? `按 ${format(goal.weightKg)} kg 计算 · 每日目标` : "设置计算体重，得到每日摄入目标";
    el("mealGoalContext").textContent = goal ? `每日目标 · 按 ${format(goal.weightKg)} kg 计算` : "按体重设置每日营养目标";
    for (const { key, id, label } of GOAL_MACROS) {
      el(`accountTarget${id}`).textContent = format(targets?.[key]);
      el(`mealTarget${id}`).textContent = format(targets?.[key]);
      el(`mealTarget${id}Line`).hidden = !goal;
      const progress = goal && !loading ? nutritionGoalProgress(totals[key], targets[key]) : null;
      const bar = el(`meal${id}Progress`);
      bar.hidden = !goal;
      bar.querySelector("span").style.width = `${progress?.percent || 0}%`;
      bar.setAttribute("aria-label", `${label}摄入进度`);
      if (progress) {
        bar.setAttribute("aria-valuenow", String(progress.percent));
        bar.setAttribute("aria-valuetext", `已摄入 ${format(totals[key])} g，目标 ${format(targets[key])} g`);
      } else { bar.removeAttribute("aria-valuenow"); bar.setAttribute("aria-valuetext", loading ? "正在读取" : "尚无营养数据"); }
      const status = el(`meal${id}Remaining`);
      status.hidden = !goal;
      status.textContent = loading ? "正在读取…" : !progress ? "待记录摄入" : progress.over ? `超出 ${format(progress.over)} g` : progress.remaining ? `还差 ${format(progress.remaining)} g` : "已达目标";
    }
  }
  function open() {
    if (saving) return;
    const goal = currentGoal(), latest = latestWeight();
    weight.value = goal?.weightKg ?? latest?.weight ?? "";
    for (const { key, id } of GOAL_MACROS) el(`nutritionGoal${id}`).value = goal?.ratios[key] ?? DEFAULT_NUTRITION_RATIOS[key];
    el("nutritionUseLatestWeight").hidden = !latest;
    el("nutritionUseLatestWeight").textContent = latest ? `使用最近体重 ${format(latest.weight)} kg` : "使用最近体重";
    message.textContent = "";
    editorGeneration = storage.sync.generation;
    preview(); dialog.showModal();
  }
  el("accountNutritionButton").addEventListener("click", open);
  el("mealGoalButton").addEventListener("click", open);
  el("nutritionUseLatestWeight").addEventListener("click", () => { const latest = latestWeight(); if (latest) { weight.value = latest.weight; preview(); } });
  form.addEventListener("input", () => { message.textContent = ""; preview(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    if (editorGeneration !== storage.sync.generation) { dialog.close(); return; }
    const goal = readDraft();
    if (!goal) { message.textContent = "请填写有效体重和系数，至少一项系数大于 0。"; return; }
    saving = true; save.disabled = true;
    try {
      await storage.updateProfile({ nutritionGoal: goal });
      if (editorGeneration !== storage.sync.generation) return;
      render(); dialog.close(); showToast("每日营养目标已保存", false);
    } catch (error) { if (editorGeneration === storage.sync.generation) message.textContent = error.message; }
    finally { saving = false; save.disabled = false; }
  });
  dialog.addEventListener("click", event => { const b = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) dialog.close(); });
  window.addEventListener("body-measurements-change", () => render());
  return { render };
}
