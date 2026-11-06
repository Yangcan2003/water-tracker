import { toDateKey, fromDateKey } from "./utils.js";

export function recordWeekView(selectedDate, today) {
  const selected = fromDateKey(selectedDate), monday = fromDateKey(selectedDate);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday); date.setDate(date.getDate() + index);
    const key = toDateKey(date);
    return { key, number: date.getDate(), weekday: ["一", "二", "三", "四", "五", "六", "日"][index],
      selected: key === selectedDate, today: key === today, future: key > today,
      label: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，周${["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}${key === today ? "，今天" : ""}` };
  });
  const previous = new Date(selected), next = new Date(selected);
  previous.setDate(previous.getDate() - 7); next.setDate(next.getDate() + 7);
  return { days, monthLabel: `${selected.getFullYear()}年${selected.getMonth() + 1}月`,
    previous: toDateKey(previous), next: toDateKey(next) > today ? today : toDateKey(next),
    canGoNext: days[6].key < today };
}
