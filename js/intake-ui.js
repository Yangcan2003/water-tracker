import { esc } from "./utils.js";
import { SCHEDULE_LABELS } from "./supplement-plan.js";

const paths = {
  medicine: '<path d="m10 4-6 6a6 6 0 0 0 8 8l6-6a6 6 0 0 0-8-8ZM7 7l10 10"/>',
  supplement: '<path d="M9 3h6v4H9zM9 7v3l-3 3v7h12v-7l-3-3V7M6 15h12"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5Z"/>',
  minus: '<path d="M5 12h14"/>',
};
export function intakeIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.medicine}</svg>`;
}

// Progress counts doses, so a partially completed multi-dose item is represented.
export function intakeSummary(items) {
  const active = items.filter(item => item.active);
  const done = active.filter(item => item.count >= item.target).length;
  const target = active.reduce((sum, item) => sum + item.target, 0);
  const taken = active.reduce((sum, item) => sum + Math.min(item.count, item.target), 0);
  return { total: active.length, done, pending: active.length - done, target, taken,
    remaining: target - taken, percent: target ? Math.round(taken / target * 100) : 0 };
}

export function intakeCard(item, type, busy = false) {
  const { name, count, target, active, reason } = item;
  const done = count >= target;
  const state = !active ? "off" : done ? "done" : count ? "partial" : "pending";
  const disabled = busy ? ' disabled' : '';
  return `<article class="intake-item intake-item-${state}" data-name="${esc(name)}" aria-busy="${busy}">
    <div class="intake-item-top"><span class="intake-symbol">${intakeIcon(type)}</span><div class="intake-item-copy"><h3>${esc(name)}</h3><p>${esc(item.dosage || "剂量未设置")}<span>·</span>每日 ${target} 次</p></div><button type="button" class="intake-edit" data-intake-action="edit" data-name="${esc(name)}" aria-label="编辑 ${esc(name)}"${disabled}>${intakeIcon("edit")}</button></div>
    <div class="intake-item-meta"><span>${esc(SCHEDULE_LABELS[item.schedule] || "每天")}</span></div>
    ${active ? `<div class="intake-item-bottom"><div class="intake-dose-progress"><span><b>${count}</b> / ${target} 次</span><div class="intake-mini-track"><i style="width:${Math.min(count / target, 1) * 100}%"></i></div></div><div class="intake-item-actions"><button type="button" class="intake-minus" data-intake-action="minus" data-name="${esc(name)}" aria-label="${esc(name)}减去一次"${!count || busy ? ' disabled' : ''}>${intakeIcon("minus")}</button><button type="button" class="intake-record" data-intake-action="record" data-name="${esc(name)}" aria-label="${esc(name)}${done ? '已完成' : '记录一次'}"${done || busy ? ' disabled' : ''}>${intakeIcon(done ? "check" : "plus")}${busy ? "保存中" : done ? "" : "记录一次"}</button></div></div>` : `<p class="intake-off-note">${esc(reason || "本日不在计划内")}${count ? ` · 已记录 ${count} 次，记录仍保留` : ""}</p>`}
  </article>`;
}
