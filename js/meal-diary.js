import { fromDateKey, toDateKey } from "./utils.js";
import { isMealPhoto } from "./meals.js";
import { NUTRITION_FIELDS, normalizeMealNutrition } from "./meal-nutrition.js";

export const MEAL_TYPES = {
  breakfast: { label: "早餐", icon: "sunrise", caption: "开启新的一天" },
  lunch: { label: "午餐", icon: "sun", caption: "给午后补充能量" },
  dinner: { label: "晚餐", icon: "moon", caption: "好好吃一顿晚饭" },
  snack: { label: "加餐", icon: "apple", caption: "水果、饮品或小食" },
};
const paths = {
  sunrise: '<path d="M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v5M3 10l3 3m15-3-3 3m-9-7 3-3 3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  apple: '<path d="M12 7c-6-5-11 2-7 9 3 6 5 3 7 3s4 3 7-3c4-7-1-14-7-9Zm0-1c0-3 2-4 4-4"/>',
  camera: '<path d="M8 5l1-2h6l1 2h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
  pen: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plate: '<circle cx="13" cy="12" r="6"/><path d="M3 3v6m3-6v6M3 7h3M4.5 9v12M21 3v18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-12 5h.01M15 15h.01"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2"/>',
  scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3m8 0h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M8 12h8m-4-4v8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
export function mealIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.plate}</svg>`;
}
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function mealRecordDate(record) {
  const value = record.recordedAt;
  return new Date(value?.toDate?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : value));
}
export function mealDaySummary(records) {
  const main = ["breakfast", "lunch", "dinner"];
  const completed = main.filter(type => records.some(record => record.mealType === type));
  return { completed, missing: main.filter(type => !completed.includes(type)), count: records.length,
    photos: records.reduce((count, record) => count + (record.photos || []).filter(isMealPhoto).length, 0) };
}
export function mealDateLabel(dateKey, now = new Date()) {
  const date = fromDateKey(dateKey);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const relative = dateKey === toDateKey(now) ? "今天" : dateKey === toDateKey(yesterday) ? "昨天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return { relative, full: date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" }) };
}
export function mealWeekDays(dateKey, now = new Date()) {
  const selected = fromDateKey(dateKey), monday = new Date(selected);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday); date.setDate(date.getDate() + index);
    const key = toDateKey(date);
    return { key, number: date.getDate(), weekday: ["一", "二", "三", "四", "五", "六", "日"][index],
      selected: key === dateKey, today: key === toDateKey(now), future: key > toDateKey(now) };
  });
}
export function mealEntryHTML(record) {
  const meta = { label: "食物" };
  const date = mealRecordDate(record), validDate = !Number.isNaN(date.getTime());
  const time = validDate ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "时间待补充";
  const photos = (record.photos || []).filter(isMealPhoto);
  const title = record.name?.trim() || (photos.length ? "食物照片" : "饮食记录");
  const nutrition = normalizeMealNutrition(record.nutrition);
  const keyExtras = nutrition ? NUTRITION_FIELDS.filter(field => ["fiberG", "sodiumMg"].includes(field.key) && nutrition[field.key] != null) : [];
  const keyExtraHTML = keyExtras.length ? `<dl class="diary-entry-key-nutrients">${keyExtras.map(field => `<div><dt>${field.label}</dt><dd>${nutrition[field.key]}<small> ${field.unit}</small></dd></div>`).join("")}</dl>` : "";
  const nutritionHTML = nutrition ? `<div class="diary-entry-nutrition"><div><strong>${nutrition.kcal}<small> kcal</small></strong><span>${nutrition.source === "manual" ? "已调整估算" : "AI 估算"}</span></div><dl>${NUTRITION_FIELDS.slice(1, 4).map(field => `<div><dt>${field.label}</dt><dd>${nutrition[field.key]}<small> g</small></dd></div>`).join("")}</dl>${keyExtraHTML}</div>` : "";
  const extras = nutrition ? NUTRITION_FIELDS.filter(field => field.optional && !["fiberG", "sodiumMg"].includes(field.key) && nutrition[field.key] != null) : [];
  const extraHTML = extras.length ? `<details class="nutrition-more"><summary>更多营养</summary><dl class="nutrition-extra-values">${extras.map(field => `<div><dt>${field.label}</dt><dd>${nutrition[field.key]} <small>${field.unit}</small></dd></div>`).join("")}</dl></details>` : "";
  return `<article class="diary-entry${photos.length ? " has-photos" : " text-only"}" data-meal-record="${escape(record.id)}">
    <div class="diary-entry-top">${!photos.length ? `<span class="diary-text-icon">${mealIcon("plate")}</span>` : ""}<div class="diary-entry-copy"><h4>${escape(title)}</h4><div class="diary-entry-meta">${mealIcon("clock")}<time${validDate ? ` datetime="${date.toISOString()}"` : ""}>${time}</time>${photos.length ? `<span>· ${photos.length} 张照片</span>` : ""}</div></div><button class="diary-entry-more" type="button" data-meal-actions="${escape(record.id)}" aria-label="${escape(title)}，更多操作">${mealIcon("more")}</button></div>
    ${photos.length ? `<div class="diary-photo-grid photos-${photos.length}">${photos.map((photo, index) => `<button type="button" data-id="${escape(record.id)}" data-meal-photo="${index}" aria-label="查看${meta.label}第 ${index + 1} 张照片"><img src="${photo}" alt="${meta.label}照片 ${index + 1}" loading="lazy" /></button>`).join("")}</div>` : ""}
    ${nutritionHTML}${extraHTML}
    ${record.note ? `<p class="diary-entry-note">${escape(record.note)}</p>` : ""}</article>`;
}
