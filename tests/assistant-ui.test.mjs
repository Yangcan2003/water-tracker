import test from "node:test";
import assert from "node:assert/strict";
import { awaitAssistantOperation, formatAssistantText } from "../js/assistant-ui.js";
import { ASSISTANT_CATEGORIES, assistantHistoryRange, buildHealthContext } from "../js/assistant-context.js";

test("a stalled native operation releases the UI on cancellation and rejects late answers", async () => {
  const abort = new AbortController(); let resolve;
  const response = awaitAssistantOperation(new Promise(done => { resolve = done; }), abort.signal);
  abort.abort("user");
  await assert.rejects(response, { name: "AbortError" });
  resolve({ reply: "late" });
  assert.equal(await awaitAssistantOperation(Promise.resolve("ok")), "ok");
});
test("model formatting permits readable lists and emphasis but escapes HTML", () => {
  const html = formatAssistantText('### 提示\n\n- **喝水**\n- <img src=x onerror=alert(1)>\n\n`<script>`');
  assert.match(html, /<h3>提示<\/h3>/); assert.match(html, /<strong>喝水<\/strong>/);
  assert.match(html, /<ul><li>/); assert.ok(!html.includes("<img")); assert.ok(!html.includes("<script>"));
});
test("all-history health context includes every category and dated measurements without account or photo fields", () => {
  const categories = ASSISTANT_CATEGORIES.map(item => item.key), now = new Date(2026, 9, 15);
  assert.deepEqual(assistantHistoryRange("all", now), { startDate: "0001-01-01", endDate: "2026-10-15" });
  const days = [{ dateKey: "2025-01-01", waterRecs: [{ amount: 200, uid: "secret-uid" }], medRecs: [{ name: "药物 A", count: 2, dosage: "记录剂量" }], suppRecs: [{ name: "补剂 B", count: 1 }], toiletRecs: [{ type: "small" }], mealRecs: [{ mealType: "lunch", name: "午餐", photos: ["secret-photo"] }], isWorkout: true, workoutDetail: { activity: "步行", duration: 20 } }];
  const context = buildHealthContext(days, { rangeDays: "all", categories, compact: true, now, profile: { dailyGoal: 2000, email: "secret-email" }, bodyMeasurements: { a: { id: "a", date: "2024-01-01", weight: 60 }, b: { id: "b", date: "2026-10-16", weight: 61 }, c: { id: "c", date: "2023-01-01", weight: 62, deleted: true } } });
  assert.equal(context.range.startDate, "2024-01-01"); assert.deepEqual(context.categories, categories);
  for (const key of ["water", "medicine", "supplement", "toilet", "meal", "workout"]) assert.ok(context.days[0][key]);
  assert.equal(context.bodyMeasurements.length, 1); assert.equal(context.dailyWaterGoalMl, 2000);
  assert.ok(!JSON.stringify(context).includes("secret-"));
});
test("large histories summarize all recorded dates instead of truncating to recent days", () => {
  const days = Array.from({ length: 400 }, (_, index) => {
    const date = new Date(2025, 0, 1 + index), dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { dateKey, waterRecs: Array.from({ length: 5 }, () => ({ amount: 100 })), mealRecs: [{ name: "食物".repeat(60), note: "备注".repeat(60), mealType: "lunch" }], toiletRecs: [{ type: "big" }] };
  });
  const context = buildHealthContext(days, { rangeDays: "all", categories: ASSISTANT_CATEGORIES.map(item => item.key), compact: true, now: new Date(2026, 9, 15) });
  assert.ok(context.summarized); assert.ok(JSON.stringify(context).length <= 18000);
  assert.equal(context.days.reduce((sum, item) => sum + item.recordedDays, 0), 400);
  assert.equal(context.days.reduce((sum, item) => sum + item.water.totalMl, 0), 200000);
  assert.match(context.note, /原始明细/);
});
