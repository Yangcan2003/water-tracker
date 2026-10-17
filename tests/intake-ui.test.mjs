import test from "node:test";
import assert from "node:assert/strict";
import { intakeSummary, intakeCard } from "../js/intake-ui.js";

test("dose progress includes partial intake and excludes non-scheduled plans", () => {
  assert.deepEqual(intakeSummary([
    { active: true, count: 1, target: 2 },
    { active: true, count: 1, target: 1 },
    { active: false, count: 0, target: 20 },
  ]), { total: 2, done: 1, pending: 1, target: 3, taken: 2, remaining: 1, percent: 67 });
  assert.equal(intakeSummary([]).percent, 0);
  assert.equal(intakeSummary([{ active: true, count: 5, target: 2 }]).remaining, 0);
});

test("completed cards disable recording but retain an explicit correction control", () => {
  const html = intakeCard({ name: 'A"<B>', active: true, target: 2, count: 2, dosage: "1片", schedule: "everyday" }, "medicine");
  assert.match(html, /aria-label="A&quot;&lt;B&gt;已完成" disabled/);
  assert.match(html, /data-intake-action="minus"[^>]*aria-label="[^>]*减去一次">/);
  assert.doesNotMatch(html, /<B>/);
});

test("unscheduled cards never offer dose recording; busy cards disable all actions", () => {
  const item = { name: "鱼油", active: false, target: 1, count: 0, reason: "非健身日" };
  assert.doesNotMatch(intakeCard(item, "supplement"), /data-intake-action="record"/);
  const busy = intakeCard({ ...item, active: true }, "supplement", true);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /aria-label="编辑 鱼油" disabled/);
  assert.match(busy, /aria-label="鱼油记录一次" disabled/);
});
