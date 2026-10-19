import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createForegroundDeadline } from "../js/assistant-deadline.js";

function fixture(hidden = false) {
  const lifecycle = new EventTarget(); lifecycle.hidden = hidden;
  let now = 0, nextID = 0, expired = 0;
  const timers = new Map();
  const clock = { lifecycle, now: () => now, schedule: (callback, delay) => { const id = ++nextID; timers.set(id, { callback, due: now + delay }); return id; }, cancel: id => timers.delete(id) };
  return {
    start: () => createForegroundDeadline(65000, () => expired++, clock),
    advance(milliseconds) { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); } },
    visibility(value) { lifecycle.hidden = value; lifecycle.dispatchEvent(new Event("visibilitychange")); },
    expired: () => expired, count: () => timers.size,
  };
}
test("background minutes never consume the visible preparation deadline", () => {
  const f = fixture(); f.start(); f.advance(10000); f.visibility(true); f.advance(10 * 60_000);
  assert.equal(f.expired(), 0); assert.equal(f.count(), 0);
  f.visibility(false); f.advance(54000); assert.equal(f.expired(), 0);
  f.advance(1000); assert.equal(f.expired(), 1); assert.equal(f.count(), 0);
});
test("native ownership disarms the WebView deadline and late visibility events", () => {
  const f = fixture(); const deadline = f.start(); deadline.stop();
  f.visibility(true); f.advance(600000); f.visibility(false); f.advance(65000);
  assert.equal(f.expired(), 0); assert.equal(f.count(), 0);
});
test("initially hidden and repeated active events do not start or extend a deadline", () => {
  const f = fixture(true); f.start(); f.advance(100000); assert.equal(f.count(), 0);
  f.visibility(false); f.advance(60000); f.visibility(false); f.advance(5000);
  assert.equal(f.expired(), 1);
});
test("Swift lifecycle recovery retains completed results and resumes only interrupted inference", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp("/private/tmp/water-assistant-background-tests-");
  try {
    execFileSync("xcrun", ["swiftc", "-module-cache-path", `${directory}/cache`, "ios/App/App/ChatGPTCore.swift", "tests/ChatGPTRecoveryTests.swift", "-o", `${directory}/checks`], { timeout: 60000, stdio: "pipe" });
    assert.match(execFileSync(`${directory}/checks`, { encoding: "utf8", timeout: 10000 }), /checks passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
