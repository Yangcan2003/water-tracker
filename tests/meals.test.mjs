import test from "node:test";
import assert from "node:assert/strict";
import { MealTimeDraft, mealImageSize, isMealPhoto, MAX_MEAL_PHOTO_LENGTH } from "../js/meals.js";
import { toDateKey, toTimeValue } from "../js/utils.js";

test("meal defaults lock at first photo or text, including when saved much later", () => {
  const draft = new MealTimeDraft("2026-10-12", null, new Date(2026, 9, 12, 8, 0));
  draft.capture(new Date(2026, 9, 12, 8, 15));
  draft.capture(new Date(2026, 9, 12, 8, 40));
  assert.equal(toTimeValue(draft.recordedAt), "08:15");
});
test("manual meal times survive subsequent photos/text, and edits keep the original time", () => {
  const draft = new MealTimeDraft("2026-10-12");
  draft.setTime("07:20");
  draft.capture(new Date(2026, 9, 12, 9, 0));
  assert.equal(toTimeValue(draft.recordedAt), "07:20");
  const edit = new MealTimeDraft("2026-10-12", draft.recordedAt);
  edit.capture(new Date(2026, 9, 12, 12, 0));
  assert.equal(toTimeValue(edit.recordedAt), "07:20");
  edit.setTime("08:10");
  assert.equal(toTimeValue(edit.recordedAt), "08:10");
});
test("backfilled meals combine the selected date with the captured time, and reject invalid times", () => {
  const draft = new MealTimeDraft("2026-10-01");
  draft.capture(new Date(2026, 9, 12, 0, 5));
  assert.equal(toDateKey(draft.recordedAt), "2026-10-01");
  assert.equal(toTimeValue(draft.recordedAt), "00:05");
  for (const time of ["", "24:00", "12:60", "9:05"]) {
    draft.setTime(time);
    assert.throws(() => draft.recordedAt, /有效/);
  }
});
test("meal photos retain their aspect ratio and bound the cloud document size", () => {
  assert.deepEqual(mealImageSize(4032, 3024), { width: 1200, height: 900 });
  assert.deepEqual(mealImageSize(3024, 4032), { width: 900, height: 1200 });
  assert.deepEqual(mealImageSize(320, 240), { width: 320, height: 240 });
  assert.equal(isMealPhoto("data:image/jpeg;base64,YQ=="), true);
  assert.equal(isMealPhoto('" onerror="alert(1)'), false);
  assert.equal(isMealPhoto("data:image/jpeg;base64," + "a".repeat(MAX_MEAL_PHOTO_LENGTH)), false);
  assert.throws(() => mealImageSize(0, 100));
});
