export const SCHEDULE_LABELS = {
  everyday: "每天", weekday: "仅工作日", workout: "仅训练日", workout_weekday: "工作日训练日",
};

// An explicit empty plan stays empty; removed defaults must not reappear.
export function enabledPlans(items) {
  return items.filter(item => item.enabled !== false);
}

export const enabledSupplements = enabledPlans;

export function normalizePlans(items, type) {
  return items.map(item => item.id ? item : { ...item, id: `legacy:${type}:${item.name}`, legacyNames: [item.name] });
}

export function planMatchesRecord(item, record) {
  if (record.planId) return record.planId === item.id;
  return (item.legacyNames || (item.id ? [] : [item.name])).includes(record.name);
}

// Plan IDs are references stored in record fields, not Firestore document paths.
// Preserve old name-based IDs verbatim, including slashes and Unicode names.
export function validPlanID(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
}

export function planRecordCount(item, records) {
  return records.reduce((total, record) => {
    if (!planMatchesRecord(item, record)) return total;
    const count = Number(record.count ?? (record.taken ? 1 : 0));
    return total + (Number.isFinite(count) ? Math.max(0, count) : 0);
  }, 0);
}
