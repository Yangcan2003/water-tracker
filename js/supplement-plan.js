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
