import { BODY_METRICS, formatMeasurement, latestMeasurements, measurementHistory } from "./body-measurements.js";
import { esc, toDateKey } from "./utils.js";

export function createBodyMeasurementsPage({ storage, showToast }) {
  const element = id => document.getElementById(id);
  const summary = element("bodyMetricSummary"), form = element("bodyMeasurementForm");
  const entryDialog = element("bodyMeasurementDialog"), historyDialog = element("bodyHistoryDialog");
  const historyList = element("bodyHistoryList"), message = element("bodyMeasurementMessage");
  let returnToHistory = false, pendingDelete = null, saving = false;
  let owner = storage.currentUser?.uid || "__local__";
  const dateLabel = date => String(date).replaceAll("-", ".");

  function render() {
    const nextOwner = storage.currentUser?.uid || "__local__";
    if (nextOwner !== owner) {
      owner = nextOwner;
      returnToHistory = false;
      pendingDelete = null;
      entryDialog.close();
      historyDialog.close();
    }
    const map = storage.getCachedBodyMeasurements();
    const latest = latestMeasurements(map), history = measurementHistory(map);
    summary.innerHTML = BODY_METRICS.map(metric => {
      const entry = latest[metric.key];
      return `<div><dt>${metric.label}<span>${metric.unit}</span></dt><dd>${formatMeasurement(entry?.[metric.key])}</dd><small>${entry ? esc(dateLabel(entry.date)) : "尚未记录"}</small></div>`;
    }).join("");
    element("bodyHistorySummary").textContent = history.length ? `已保存 ${history.length} 次测量` : "按需更新，保留每一次变化";
    element("bodyHistoryCount").textContent = history.length ? `共 ${history.length} 条 · 按测量日期排列，— 表示本次未填写` : "从第一次测量开始，慢慢记录身体的变化。";
    historyList.innerHTML = history.length ? history.map(entry => `
      <li class="body-history-entry" data-measurement-id="${esc(entry.id)}">
        <div class="body-history-entry-heading"><time datetime="${esc(entry.date)}">${esc(dateLabel(entry.date))}</time><button class="body-delete-button" type="button" data-body-delete="${esc(entry.id)}" aria-label="删除 ${esc(dateLabel(entry.date))} 的记录">删除</button></div>
        <dl class="body-history-values">${BODY_METRICS.map(metric => `<div><dt>${metric.label}</dt><dd>${formatMeasurement(entry[metric.key])}${entry[metric.key] == null ? "" : `<small>${metric.unit}</small>`}</dd></div>`).join("")}</dl>
        ${pendingDelete === entry.id ? `<div class="body-delete-confirm"><span>删除这次测量？其他记录会保留。</span><div><button type="button" data-body-cancel>取消</button><button type="button" data-body-confirm="${esc(entry.id)}">确认删除</button></div></div>` : ""}
      </li>`).join("") : '<li class="body-history-empty"><span aria-hidden="true">＋</span><strong>还没有身体记录</strong><p>身高、体重、体脂率可以分开记录，<br>不用每次都测量全部项目。</p></li>';
  }

  function openEntry(fromHistory = false) {
    returnToHistory = fromHistory;
    historyDialog.close();
    form.reset();
    const today = toDateKey(new Date());
    form.elements.date.max = today;
    form.elements.date.value = today;
    const latest = latestMeasurements(storage.getCachedBodyMeasurements());
    for (const metric of BODY_METRICS) {
      const previous = latest[metric.key];
      form.elements[metric.key].placeholder = previous ? `上次 ${formatMeasurement(previous[metric.key])}` : "选填";
    }
    message.textContent = "";
    entryDialog.showModal();
  }

  element("bodyMeasurementAdd").addEventListener("click", () => openEntry());
  element("bodyHistoryButton").addEventListener("click", () => { pendingDelete = null; render(); historyDialog.showModal(); });
  element("bodyHistoryAdd").addEventListener("click", () => openEntry(true));
  form.addEventListener("input", () => { message.textContent = ""; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    saving = true;
    element("bodyMeasurementSave").disabled = true;
    try {
      await storage.addBodyMeasurement(Object.fromEntries(new FormData(form)));
      render();
      entryDialog.close();
      showToast("身体数据已保存", false);
    } catch (error) { message.textContent = error.message; }
    finally { saving = false; element("bodyMeasurementSave").disabled = false; }
  });
  entryDialog.addEventListener("close", () => {
    if (returnToHistory) { returnToHistory = false; render(); historyDialog.showModal(); }
  });
  historyList.addEventListener("click", async event => {
    const remove = event.target.closest("[data-body-delete]");
    if (remove) { pendingDelete = remove.dataset.bodyDelete; render(); return; }
    if (event.target.closest("[data-body-cancel]")) { pendingDelete = null; render(); return; }
    const confirm = event.target.closest("[data-body-confirm]");
    if (!confirm) return;
    confirm.disabled = true;
    try {
      await storage.deleteBodyMeasurement(confirm.dataset.bodyConfirm);
      pendingDelete = null;
      render();
      showToast("已删除这次测量", false);
    } catch (error) { showToast(error.message, false); confirm.disabled = false; }
  });
  for (const dialog of [entryDialog, historyDialog]) {
    dialog.addEventListener("click", event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
  }
  window.addEventListener("body-measurements-change", render);
  return { render };
}
