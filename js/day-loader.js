// Show durable local records first. Each cloud category refreshes independently;
// photos, uploads and unrelated slow reads never hold the whole day hostage.
export function loadDaySnapshot(storage, dateKey, onUpdate, isCurrent = () => true) {
  const generation = storage.sync.generation;
  const current = () => generation === storage.sync.generation && isCurrent();
  const publish = partial => { if (current()) onUpdate(partial); };
  publish(storage.getCachedDay(dateKey));

  let cloudMealsLoaded = false;
  const revision = storage.dayRevisions.get(dateKey);
  const photos = storage.getCachedMealLogs(dateKey).then(meal => {
    if (!cloudMealsLoaded && revision === storage.dayRevisions.get(dateKey)) publish({ meal });
  });
  const readers = !storage.isCloud || !navigator.onLine ? [] : [
    ["water", () => storage.getWaterLogs(dateKey)],
    ["medicine", () => storage.getLogs("medicine", dateKey)],
    ["supplement", () => storage.getLogs("supplement", dateKey)],
    ["toilet", () => storage.getLogs("toilet", dateKey)],
    ["meal", () => storage.getMealLogs(dateKey)],
    ["workout", () => storage.getWorkoutDetail(dateKey)],
  ];
  return Promise.allSettled([photos, ...readers.map(async ([type, read]) => {
    const records = await read();
    if (type === "meal") cloudMealsLoaded = true;
    publish({ [type]: records });
  })]);
}
