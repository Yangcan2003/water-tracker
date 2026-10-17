import { toDateKey } from "./utils.js";

/** Rolling calendar days, including today; local dates also work across DST changes. */
export function historyRange(days = 7, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateKey(start), endDate: toDateKey(now) };
}

export function inHistoryRange(dateKey, range) {
  return !range || (dateKey >= range.startDate && dateKey <= range.endDate);
}
