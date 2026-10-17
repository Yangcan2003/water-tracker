import test from "node:test";
import assert from "node:assert/strict";
import { mealDaySummary, mealDateLabel, mealWeekDays, mealEntryHTML } from "../js/meal-diary.js";
const photo = "data:image/jpeg;base64,YQ==";

test("diary summary counts meal coverage rather than dishes and ignores invalid photo sources", () => {
  const summary = mealDaySummary([
    { mealType: "breakfast", photos: [photo, "https://example.com/food.jpg"] },
    { mealType: "breakfast" }, { mealType: "dinner", photos: [photo] }, { mealType: "snack", photos: [photo] },
  ]);
  assert.deepEqual(summary, { completed: ["breakfast", "dinner"], missing: ["lunch"], count: 4, photos: 3 });
  assert.equal(mealDaySummary([{ mealType: "snack" }]).completed.length, 0);
});
test("week navigation uses calendar dates across year boundaries and disables future days", () => {
  const week = mealWeekDays("2026-01-01", new Date(2026, 0, 1, 18));
  assert.deepEqual(week.map(day => day.key), ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.equal(week[3].selected, true);
  assert.equal(week[3].today, true);
  assert.equal(week[4].future, true);
  assert.equal(mealDateLabel("2025-12-31", new Date(2026, 0, 1)).relative, "昨天");
});
test("entry rendering preserves the recorded time, escapes user text/IDs and supports photo-only meals", () => {
  const html = mealEntryHTML({ id: 'a" onclick="bad', mealType: "lunch", name: '<img src=x onerror="bad">', note: '<script>bad</script>', recordedAt: new Date(2026, 9, 15, 12, 35), photos: [photo, 'javascript:alert(1)'] });
  assert.match(html, /12:35/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot; onclick=&quot;bad/);
  assert.doesNotMatch(html, /<script>|javascript:alert/);
  assert.equal((html.match(/data-meal-photo=/g) || []).length, 1);
  const photoOnly = mealEntryHTML({ id: "photo", mealType: "dinner", photos: [photo], recordedAt: new Date() });
  assert.match(photoOnly, /食物照片/);
  const text = mealEntryHTML({ id: "text", mealType: "snack", name: "苹果", recordedAt: new Date() });
  assert.match(text, /text-only/);
  assert.doesNotMatch(text, /diary-photo-grid/);
});
