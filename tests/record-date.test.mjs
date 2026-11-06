import test from "node:test";
import assert from "node:assert/strict";
import { recordWeekView } from "../js/record-date.js";

test("the week starts on Monday, including when the selected day is Sunday", () => {
  for (const selected of ["2026-11-02", "2026-11-06", "2026-11-08"]) {
    const week = recordWeekView(selected, "2026-11-08");
    assert.equal(week.days[0].key, "2026-11-02");
    assert.equal(week.days[6].key, "2026-11-08");
    assert.equal(week.days.filter(day => day.selected).length, 1);
    assert.equal(week.days.find(day => day.selected).key, selected);
    assert.equal(week.canGoNext, false);
  }
});

test("week navigation crosses years and caps a return to the current week at today", () => {
  const week = recordWeekView("2025-12-31", "2026-01-02");
  assert.deepEqual(week.days.map(day => day.key), ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.equal(week.monthLabel, "2025年12月");
  assert.equal(week.previous, "2025-12-24");
  assert.equal(week.next, "2026-01-02");
  assert.equal(week.days[4].today, true);
  assert.equal(week.days.filter(day => day.future).length, 2);
  const pastSunday = recordWeekView("2025-12-28", "2026-01-02");
  assert.equal(pastSunday.canGoNext, true);
  assert.equal(pastSunday.next, "2026-01-02");
});

test("calendar arithmetic retains all seven dates across leap day and DST boundaries", () => {
  assert.deepEqual(recordWeekView("2024-02-29", "2026-11-06").days.map(day => day.number), [26, 27, 28, 29, 1, 2, 3]);
  for (const zone of ["Asia/Shanghai", "America/New_York"]) {
    const original = process.env.TZ;
    try {
      process.env.TZ = zone;
      const week = recordWeekView("2026-11-01", "2026-11-06");
      assert.equal(week.days[0].key, "2026-10-26");
      assert.equal(week.days[6].key, "2026-11-01");
      assert.equal(week.next, "2026-11-06");
      assert.match(week.days[6].label, /2026年11月1日，周日/);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  }
});
