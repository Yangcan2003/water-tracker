import { esc, fromDateKey } from "./utils.js";
import { historyDayEvents, historyDayLabel } from "./history-model.js";
import { historyIcon } from "./history-page.js";

export function historyDetailHTML(day) {
  const events = historyDayEvents(day);
  const date = fromDateKey(day.dateKey).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  return `<div class="history-detail-heading"><button class="history-back-btn" type="button">‹ 返回记录</button><strong>${historyDayLabel(day.dateKey)}</strong><span>${date}</span></div>
    <div class="history-detail-count"><h3>当天记录</h3><span>${events.length} 笔</span></div>
    <ol class="history-event-list">${events.map(event => `<li class="history-event history-metric-${event.category}">
      <span class="history-event-time">${event.date ? event.date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "当天"}</span>
      <span class="history-event-icon">${historyIcon(event.category)}</span>
      <span class="history-event-copy"><span><strong>${esc(event.title)}</strong><b>${esc(event.value)}</b></span>${event.detail ? `<small>${esc(event.detail)}</small>` : ""}</span>
    </li>`).join("")}</ol>`;
}
