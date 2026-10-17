export const SCHEDULE_LABELS = {
  everyday: "每天", weekday: "仅工作日", workout: "仅训练日", workout_weekday: "工作日训练日",
};

// An explicit empty plan stays empty; removed defaults must not reappear.
export function enabledPlans(items) {
  return items.filter(item => item.enabled !== false);
}

export const enabledSupplements = enabledPlans;
