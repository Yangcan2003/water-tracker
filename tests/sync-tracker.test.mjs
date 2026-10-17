import test from "node:test";
import assert from "node:assert/strict";
import { SyncTracker } from "../js/sync-tracker.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const denied = () => Object.assign(new Error("denied"), { code: "permission-denied" });

test("same-request recovery clears error; unrelated success does not", async () => {
  const sync = new SyncTracker();
  await assert.rejects(sync.run({ key: "meal", operation: async () => { throw denied(); } }));
  await sync.run({ key: "water", operation: async () => {} });
  assert.equal(sync.failures.size, 1);
  assert.equal(sync.lastSyncedAt, null);
  await sync.run({ key: "meal", operation: async () => {} });
  assert.equal(sync.failures.size, 0);
  assert.ok(sync.lastSyncedAt instanceof Date);
});

test("retry preserves only remaining failures and deduplicates concurrent retries", async () => {
  const sync = new SyncTracker();
  let mealDenied = true, attempts = 0;
  const request = { key: "meal", operation: async () => { attempts++; if (mealDenied) throw denied(); } };
  await assert.rejects(sync.run(request));
  await sync.retry();
  assert.equal(sync.failures.size, 1);
  mealDenied = false;
  await Promise.all([sync.retry(), sync.retry()]);
  assert.equal(attempts, 3);
  assert.equal(sync.failures.size, 0);
});

test("out-of-order completion cannot replace the newest state", async () => {
  const sync = new SyncTracker(), old = deferred();
  const first = sync.run({ key: "meal", operation: () => old.promise });
  await sync.run({ key: "meal", operation: async () => {} });
  old.reject(denied());
  await assert.rejects(first);
  assert.equal(sync.failures.size, 0);
  assert.equal(sync.pending, 0);
});

test("an older success cannot hide a newer failure", async () => {
  const sync = new SyncTracker(), old = deferred();
  const first = sync.run({ key: "meal", operation: () => old.promise });
  await assert.rejects(sync.run({ key: "meal", operation: async () => { throw denied(); } }));
  old.resolve();
  await first;
  assert.equal(sync.failures.size, 1);
});

test("account change isolates in-flight requests and stops the old retry batch", async () => {
  const sync = new SyncTracker(), old = deferred();
  const first = sync.run({ key: "old-account", operation: () => old.promise });
  sync.reset();
  old.reject(denied());
  await assert.rejects(first);
  assert.equal(sync.pending, 0);
  assert.equal(sync.failures.size, 0);
  assert.equal(sync.lastSyncedAt, null);
});

test("an unresponsive request times out, releases its pending count and exposes a retryable failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sync = new SyncTracker();
  let signal;
  const request = sync.run({ key: "read", kind: "read", operation: context => {
    signal = context.signal;
    return new Promise(() => {});
  } });
  const failure = assert.rejects(request, { code: "deadline-exceeded" });
  t.mock.timers.tick(12_001);
  await failure;
  assert.equal(sync.pending, 0);
  assert.equal(signal.aborted, true);
  assert.equal(sync.failures.get("read").error.code, "deadline-exceeded");
  assert.equal(sync.lastSyncedAt, null);
});

test("a stalled retry also releases its lock, and a later successful retry recovers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sync = new SyncTracker();
  let available = false;
  const request = { key: "write", kind: "write", operation: () => available ? Promise.resolve() : new Promise(() => {}) };
  const first = assert.rejects(sync.run(request), { code: "deadline-exceeded" });
  t.mock.timers.tick(12_001);
  await first;
  const retry = sync.retry();
  t.mock.timers.tick(12_001);
  await retry;
  assert.equal(sync.pending, 0);
  assert.equal(sync.retryPromise, null);
  assert.equal(sync.failures.size, 1);
  available = true;
  await sync.retry();
  assert.equal(sync.failures.size, 0);
  assert.ok(sync.lastSyncedAt instanceof Date);
});

test("a late server acknowledgement recovers only that exact write without decrementing pending twice", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sync = new SyncTracker(), server = deferred();
  const request = assert.rejects(sync.run({ key: "water", kind: "write", operation: () => server.promise }), { code: "deadline-exceeded" });
  t.mock.timers.tick(12_001);
  await request;
  assert.equal(sync.lastSyncedAt, null);
  server.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.pending, 0);
  assert.equal(sync.failures.size, 0);
  assert.ok(sync.lastSyncedAt instanceof Date);
});

test("late completion after timeout cannot hide a newer failure or contaminate another account", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sync = new SyncTracker(), old = deferred();
  const request = assert.rejects(sync.run({ key: "water", kind: "write", operation: () => old.promise }));
  t.mock.timers.tick(12_001);
  await request;
  await assert.rejects(sync.run({ key: "water", kind: "write", operation: async () => { throw denied(); } }));
  old.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.failures.get("water").error.code, "permission-denied");
  const other = deferred();
  const pending = assert.rejects(sync.run({ key: "other", kind: "write", operation: () => other.promise }));
  t.mock.timers.tick(12_001);
  await pending;
  sync.reset();
  other.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.lastSyncedAt, null);
  assert.equal(sync.failures.size, 0);
  assert.equal(sync.pending, 0);
});

test("a late read cannot claim fresh data was applied after its caller already used the cache", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sync = new SyncTracker(), server = deferred();
  const request = assert.rejects(sync.run({ key: "read", kind: "read", operation: () => server.promise }));
  t.mock.timers.tick(12_001);
  await request;
  server.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.failures.size, 1);
  assert.equal(sync.lastSyncedAt, null);
  await sync.run({ key: "read", kind: "read", operation: async () => ({ fresh: true }) });
  assert.equal(sync.failures.size, 0);
});

test("independent retries share one deadline instead of accumulating serial timeouts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sync = new SyncTracker();
  for (const key of ["water", "medicine", "meal"]) {
    const request = assert.rejects(sync.run({ key, kind: "read", operation: () => new Promise(() => {}) }));
    t.mock.timers.tick(12_001);
    await request;
  }
  const retry = sync.retry();
  assert.equal(sync.pending, 3);
  t.mock.timers.tick(12_001);
  await retry;
  assert.equal(sync.pending, 0);
  assert.equal(sync.retryPromise, null);
  assert.equal(sync.failures.size, 3);
});
