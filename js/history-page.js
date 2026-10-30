import { esc, fromDateKey } from "./utils.js";
import {
  HISTORY_CATEGORIES, currentMonth, shiftHistoryMonth, historyMonthRange,
  historyMonthCells, historyDayMetrics, filterHistoryDays, historyMonthSummary, historyDayLabel,
} from "./history-model.js";

const paths = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 0-2.34 5.66"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  water: '<path d="M12 3C9 7 5.5 10.8 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10.8 15 7 12 3Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  meal: '<path d="M6 3v6m3-6v6M3 3v6a3 3 0 0 0 6 0m-3 3v9m12 0V3c-3 0-4 4-4 8h4"/>',
  workout: '<path d="m8 8 8 8M3 7l4-4m10 18 4-4M5 11l6-6m2 14 6-6M3 9l6-6m6 18 6-6"/>',
  medicine: '<path d="m9 4-5 5a6 6 0 0 0 8 8l5-5a6 6 0 0 0-8-8Z"/><path d="m7 7 8 8"/>',
  supplement: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8m-4-4v8"/>',
  toilet: '<path d="M6 3h10v8H6zM4 11h16v2a7 7 0 0 1-7 7v1H8v-3a7 7 0 0 1-4-5Z"/><path d="M12 7h1"/>',
};
export const historyIcon = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[key]}</svg>`;
const icon = historyIcon;
const monthLabel = month => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;
const number = value => typeof value === "number" ? value.toLocaleString("zh-CN") : value;

/** Owns the history screen; day-detail presentation stays with the app. */
export function createHistoryPage(root, { storage, openDay }) {
  let month = currentMonth(), category = "all", selectedDay = null;
  let days = null, version = 0, calendarOpen = false, pickerYear = Number(month.slice(0, 4));
  let loading = false, error = null, refreshing = false, refreshMessage = "";

  root.innerHTML = `
    <div class="history-month-nav">
      <button class="history-month-title" type="button" data-history-action="choose-month" aria-label="选择月份"><span></span>${icon("down")}</button>
      <div class="history-month-actions">
        <button class="history-icon-button history-prev" type="button" data-history-action="previous" aria-label="上一个月">${icon("chevron")}</button>
        <button class="history-icon-button" type="button" data-history-action="next" aria-label="下一个月">${icon("chevron")}</button>
        <button class="history-refresh-button" type="button" data-history-action="refresh" aria-label="刷新记录">${icon("refresh")}<span>刷新</span></button>
      </div>
    </div>
    <section class="history-overview" aria-label="月度概览">
      <div class="history-overview-heading"><h2>月度概览</h2><button type="button" data-history-action="current">回到本月</button><span class="history-overview-caption"></span></div>
      <div class="history-overview-metrics"></div>
    </section>
    <div class="history-filter-bar" role="group" aria-label="记录分类">${HISTORY_CATEGORIES.map(item => `<button type="button" data-history-category="${item.key}" aria-pressed="${item.key === "all"}">${item.label}</button>`).join("")}</div>
    <div class="history-list-toolbar"><div><h2>每日记录</h2><span class="history-list-count"></span></div><button class="history-calendar-toggle" type="button" data-history-action="calendar" aria-expanded="false" aria-controls="historyCalendar">${icon("calendar")}日历</button></div>
    <div class="history-calendar" id="historyCalendar" hidden></div>
    <div class="history-selected-day" hidden><span></span><button type="button" data-history-action="add-day">补录这一天</button><button type="button" data-history-action="clear-day">查看整月</button></div>
    <p class="history-load-notice" role="status" hidden></p>
    <div class="history-page-content" id="historyPageContent"></div>
    <dialog class="history-month-dialog" aria-labelledby="historyMonthDialogTitle">
      <div class="history-picker-heading"><h2 id="historyMonthDialogTitle">选择月份</h2><button class="close-button" type="button" data-history-action="close-picker" aria-label="关闭月份选择">${icon("close")}</button></div>
      <div class="history-picker-year"><button class="history-icon-button history-prev" type="button" data-history-action="previous-year" aria-label="上一年">${icon("chevron")}</button><strong></strong><button class="history-icon-button" type="button" data-history-action="next-year" aria-label="下一年">${icon("chevron")}</button></div>
      <div class="history-picker-months"></div>
      <button class="history-picker-current" type="button" data-history-action="current">回到本月</button>
    </dialog>`;
  const $ = selector => root.querySelector(selector);
  const content = $(".history-page-content"), picker = $(".history-month-dialog");

  function renderCalendar() {
    const calendar = $(".history-calendar");
    calendar.hidden = !calendarOpen;
    $(".history-calendar-toggle").setAttribute("aria-expanded", String(calendarOpen));
    if (!calendarOpen) return;
    const recordedDates = new Set(filterHistoryDays(days || [], category).map(day => day.dateKey));
    calendar.innerHTML = `<div class="history-calendar-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map(label => `<span>${label}</span>`).join("")}</div>
      <div class="history-calendar-grid">${historyMonthCells(month).map(cell => cell ? `<button type="button" data-history-date="${cell.dateKey}" class="${cell.isToday ? "is-today" : ""} ${recordedDates.has(cell.dateKey) ? "has-records" : ""}" aria-label="${cell.dateKey}${recordedDates.has(cell.dateKey) ? "，有记录" : "，暂无记录"}" aria-pressed="${selectedDay === cell.dateKey}" ${cell.isFuture ? "disabled" : ""}><span>${cell.day}</span><i aria-hidden="true"></i></button>` : '<span aria-hidden="true"></span>').join("")}</div>
      <p><i aria-hidden="true"></i>有记录的日期<span>点选日期，查看当天</span></p>`;
  }

  function renderSummary() {
    const summary = days === null ? null : historyMonthSummary(days);
    const [year, index] = month.split("-").map(Number);
    $(".history-month-title span").textContent = monthLabel(month);
    $('[data-history-action="next"]').disabled = month >= currentMonth();
    $('[data-history-action="current"]').hidden = month === currentMonth();
    $(".history-overview-caption").textContent = month === currentMonth() ? `截至 ${new Date().getDate()} 日` : `${year}年${index}月`;
    $(".history-overview-caption").hidden = month !== currentMonth();
    $(".history-overview-metrics").innerHTML = `
      <div><strong>${summary ? summary.recordedDays : "—"}<small>天</small></strong><span>记录天数</span></div>
      <div aria-label="日均饮水，仅统计有饮水记录的日期"><strong>${summary?.averageWater != null ? number(summary.averageWater) : "—"}<small>ml</small></strong><span>日均饮水</span></div>
      <div><strong>${summary ? summary.workoutDays : "—"}<small>天</small></strong><span>训练天数</span></div>`;
  }

  function render() {
    const focusedDate = root.contains(document.activeElement) ? document.activeElement.dataset.historyDate : null;
    renderSummary();
    root.querySelectorAll("[data-history-category]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.historyCategory === category)));
    renderCalendar();
    if (focusedDate) $(`[data-history-date="${focusedDate}"]`)?.focus({ preventScroll: true });
    const categoryLabel = HISTORY_CATEGORIES.find(item => item.key === category).label;
    $(".history-list-toolbar h2").textContent = category === "all" ? "每日记录" : `${categoryLabel}记录`;
    const visible = filterHistoryDays(days || [], category, selectedDay);
    $(".history-list-count").textContent = days === null ? "" : `${visible.length} 天`;
    $(".history-selected-day").hidden = !selectedDay;
    $(".history-selected-day span").textContent = selectedDay ? fromDateKey(selectedDay).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" }) : "";
    const notice = $(".history-load-notice");
    notice.hidden = !error && !refreshing && !refreshMessage;
    notice.dataset.state = error ? "error" : "info";
    notice.textContent = error ? (days !== null ? "暂时无法刷新，已保留上次加载的记录。" : "连接恢复后，可以重新加载记录。") : refreshing ? "正在刷新本月记录…" : refreshMessage;
    const refreshButton = $(".history-refresh-button");
    refreshButton.disabled = loading;
    refreshButton.setAttribute("aria-busy", String(loading));
    refreshButton.setAttribute("aria-label", loading ? "正在刷新记录" : "刷新记录");
    refreshButton.querySelector("span").textContent = loading ? (refreshing ? "刷新中" : "加载中") : "刷新";
    content.setAttribute("aria-busy", String(loading));
    if (days === null && !error) {
      content.innerHTML = `<div class="history-skeleton" role="status" aria-label="正在加载${monthLabel(month)}的记录"><span></span><i></i><i></i></div>`.repeat(2);
      return;
    }
    if (days === null && error) {
      content.innerHTML = `<div class="history-page-empty">${icon("calendar")}<strong>记录暂时未能加载</strong><p>请检查网络连接后再试。</p><button class="history-page-retry" type="button" data-history-action="refresh">重新加载</button></div>`;
      return;
    }
    if (!visible.length) {
      content.innerHTML = `<div class="history-page-empty">${icon(category === "all" ? "calendar" : category)}<strong>${selectedDay ? "这一天" : "这个月"}还没有${category === "all" ? "" : categoryLabel}记录</strong><p>${selectedDay ? "也可以看看这个月的其他日期。" : "记录会按日期保存在这里，随时回来查看。"}</p>${selectedDay ? '<button class="history-page-retry" type="button" data-history-action="clear-day">查看整月记录</button>' : ""}</div>`;
      return;
    }
    const focusedCard = root.contains(document.activeElement) ? document.activeElement.dataset.historyDay : null;
    content.innerHTML = visible.map(day => {
      const metrics = historyDayMetrics(day);
      const displayed = category === "all" ? metrics : metrics.filter(metric => metric.key === category);
      const weekday = fromDateKey(day.dateKey).toLocaleDateString("zh-CN", { weekday: "short" });
      return `<button class="history-day-card" type="button" data-history-day="${day.dateKey}" aria-label="${day.dateKey}，${esc(displayed.map(metric => `${metric.label} ${metric.value} ${metric.unit}`).join('，'))}，查看当天记录">
        <span class="history-day-heading"><span><strong>${historyDayLabel(day.dateKey)}</strong><small>${weekday}</small></span><span class="history-day-disclosure">${metrics.length} 类记录${icon("chevron")}</span></span>
        <span class="history-day-metrics">${displayed.map(metric => `<span class="history-metric history-metric-${metric.key}"><span class="history-metric-icon">${icon(metric.key)}</span><span class="history-metric-copy"><span>${metric.label}${metric.note ? ` · ${esc(metric.note)}` : ""}</span><strong>${esc(number(metric.value))}${metric.unit ? `<small>${metric.unit}</small>` : ""}</strong></span></span>`).join("")}</span>
      </button>`;
    }).join("");
    if (focusedCard) $(`[data-history-day="${focusedCard}"]`)?.focus({ preventScroll: true });
  }

  async function load({ manual = false } = {}) {
    const request = ++version;
    const range = historyMonthRange(month);
    days = storage.getCachedHistoryRange(range);
    loading = true; error = null; refreshing = manual; refreshMessage = "";
    render();
    try {
      const result = await storage.getHistoryRange(range);
      if (request !== version) return;
      days = result;
      if (manual) refreshMessage = storage.isCloud && !navigator.onLine ? "当前离线，显示上次保存的记录。" : "记录已更新。";
    } catch (failure) {
      if (request !== version) return;
      error = failure;
    } finally {
      if (request === version) { loading = false; refreshing = false; render(); }
    }
  }

  function renderPicker() {
    $(".history-picker-year strong").textContent = `${pickerYear}年`;
    $('[data-history-action="next-year"]').disabled = pickerYear >= Number(currentMonth().slice(0, 4));
    $('[data-history-action="previous-year"]').disabled = pickerYear <= 1900;
    $(".history-picker-months").innerHTML = Array.from({ length: 12 }, (_, index) => {
      const key = `${pickerYear}-${String(index + 1).padStart(2, "0")}`;
      return `<button type="button" data-history-month="${key}" aria-pressed="${key === month}" ${key > currentMonth() ? "disabled" : ""}>${index + 1}月</button>`;
    }).join("");
  }

  function changeMonth(next) {
    if (next > currentMonth() || next === month) return;
    month = next; selectedDay = null;
    void load();
  }

  root.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.historyCategory) { category = button.dataset.historyCategory; render(); return; }
    if (button.dataset.historyDate) { selectedDay = selectedDay === button.dataset.historyDate ? null : button.dataset.historyDate; render(); return; }
    if (button.dataset.historyDay) { const day = days?.find(item => item.dateKey === button.dataset.historyDay); if (day) openDay(day); return; }
    if (button.dataset.historyMonth) { picker.close(); changeMonth(button.dataset.historyMonth); return; }
    switch (button.dataset.historyAction) {
      case "previous": changeMonth(shiftHistoryMonth(month, -1)); break;
      case "next": changeMonth(shiftHistoryMonth(month, 1)); break;
      case "current": picker.close(); changeMonth(currentMonth()); break;
      case "refresh": if (!loading) { storage.invalidateHistory(); void load({ manual: true }); } break;
      case "calendar": calendarOpen = !calendarOpen; renderCalendar(); break;
      case "clear-day": selectedDay = null; render(); break;
      case "add-day": if (selectedDay) openDay(days?.find(day => day.dateKey === selectedDay) || { dateKey: selectedDay }); break;
      case "choose-month": pickerYear = Number(month.slice(0, 4)); renderPicker(); picker.showModal(); break;
      case "close-picker": picker.close(); break;
      case "previous-year": pickerYear--; renderPicker(); break;
      case "next-year": pickerYear++; renderPicker(); break;
    }
  });

  render();
  return {
    load,
    prefetch: () => storage.getHistoryRange(historyMonthRange(month)),
    reset() {
      version++; month = currentMonth(); category = "all"; selectedDay = null;
      days = null; loading = false; error = null; refreshing = false; refreshMessage = ""; calendarOpen = false;
      if (picker.open) picker.close();
      render();
    },
  };
}
