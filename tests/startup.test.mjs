import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizePlans } from "../js/supplement-plan.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const pending = () => new Promise(() => {});

test("sign-in returns a usable cached page without awaiting uploads, day reads or profile reads", async () => {
  const calls = [];
  const context = vm.createContext({
    requestVersion: 0,
    appliedUserId: undefined,
    db: {},
    historyPage: { reset() {}, prefetch() { throw new Error("startup must not fetch a whole month"); } },
    assistantPage: { resetUser() {} },
    storage: {
      sync: { generation: 0 },
      setUser() { this.sync.generation++; },
      hasLocalData: () => true,
      mergeLocalToCloud: () => { calls.push("upload"); return pending(); },
      getCachedProfile: () => ({ avatarType: "default" }),
      getCups: async () => [], getReminder: async () => ({}), getSettings: async () => ({}),
    },
    E: { profileEmail: {}, languageSelect: {}, timelinePanel: { hidden: true } },
    LAST_USER_KEY: "user", localStorage: { setItem() {} },
    setLang() {}, renderAvatar() {}, updatePageLanguage() {},
    loadProfile: () => { calls.push("profile"); return pending(); },
    loadDay: () => { calls.push("day"); return pending(); },
    switchMain: value => calls.push(value), startReminderCheck: () => calls.push("ready"),
  });
  vm.runInContext(source.slice(source.indexOf("async function applyUser(user)"), source.indexOf("async function handleAuthSubmit")), context);
  let ready = false;
  context.applyUser({ uid: "test" }).then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, true);
  assert.deepEqual(calls, ["upload", "profile", "day", "ready"]);
});

test("cached boot and Firebase initialization do not await native plugin responses", async () => {
  const calls = [];
  const context = vm.createContext({
    initializeNativePlatform: pending, initializeAppearance: pending,
    bootFromCache: async () => calls.push("cache"),
    getFirebaseConfig: async () => ({}), initializeApp: () => ({}), getAuth: () => ({}),
    initializeFirestore: () => ({}), persistentLocalCache() {}, persistentSingleTabManager() {},
    storage: { setUser() {} }, onAuthStateChanged: () => calls.push("auth"),
    applyUser() { throw new Error("unexpected initialization failure"); }, showAuthMessage() {}, E: {},
  });
  vm.runInContext(source.slice(source.indexOf("async function initialize()"), source.indexOf("// 启动时立即用 localStorage")), context);
  let ready = false;
  context.initialize().then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, true);
  assert.deepEqual(calls, ["cache", "auth"]);
});

function accountContext(section = "detail", userId) {
  const calls = [];
  const context = vm.createContext({
    appliedUserId: userId, requestVersion: 4, db: {}, currentUser: null,
    normalizePlans, backupPage: { reset() {} }, document: { querySelectorAll: () => [] },
    selectedDate: "2026-09-21", section, scrollY: 350, historyMonth: "2026-09", historyCategory: "medicine",
    DEFAULT_MEDICINES: [], DEFAULT_SUPPLEMENTS: [],
    historyPage: { reset: () => calls.push("reset-history") },
    assistantPage: { resetUser: () => calls.push("reset-assistant") },
    storage: {
      sync: { generation: 1 },
      setUser() { calls.push("set-user"); this.sync.generation++; },
      hasLocalData: () => false,
      getCachedProfile: () => ({}), getProfile: async () => ({}),
      getCups: async () => [], getReminder: async () => ({}), getSettings: async () => ({}),
    },
    E: { profileEmail: {}, languageSelect: {}, timelinePanel: { hidden: section !== "history" }, mealDialog: { open: true } },
    LAST_USER_KEY: "user", localStorage: { setItem() {}, removeItem() {} },
    setLang() {}, renderAvatar() {}, renderCups() {}, renderSyncStatus() {}, updatePageLanguage() {}, hideToast() {},
    loadProfile: () => calls.push("profile"), loadDay: () => calls.push("day"),
    loadHistoryPage: () => calls.push("refresh-history"), startReminderCheck() {},
    switchMain(value) { calls.push("navigate"); context.section = value; context.selectedDate = "today"; context.scrollY = 0; },
  });
  vm.runInContext(source.slice(source.indexOf("async function applyUser(user)"), source.indexOf("async function handleAuthSubmit")), context);
  return { context, calls };
}

test("delayed authentication preserves the current tab, detail date, scroll and open editor", async () => {
  for (const section of ["detail", "history", "assistant", "account"]) {
    const { context, calls } = accountContext(section);
    let release;
    context.storage.getCups = () => new Promise(resolve => { release = resolve; });
    const restoring = context.applyUser({ uid: "test" });
    // The user keeps navigating while identity restoration is still pending.
    context.scrollY = 780;
    release([]);
    await restoring;
    assert.equal(context.section, section);
    assert.equal(context.selectedDate, "2026-09-21");
    assert.equal(context.scrollY, 780);
    assert.equal(context.E.mealDialog.open, true);
    assert.equal(context.historyMonth, "2026-09");
    assert.equal(context.historyCategory, "medicine");
    assert.equal(calls.includes("navigate"), false);
    assert.equal(calls.includes("reset-history"), false);
    assert.equal(calls.includes("refresh-history"), section === "history");
  }
});

test("same-account callbacks update identity metadata without resetting requests, caches or filters", async () => {
  const { context, calls } = accountContext("history", "test");
  await context.applyUser({ uid: "test", email: "updated@example.test" });
  assert.deepEqual(calls, []);
  assert.equal(context.E.profileEmail.textContent, "updated@example.test");
  assert.equal(context.currentUser.uid, "test");
  assert.equal(context.storage.sync.generation, 1);
  assert.equal(context.requestVersion, 4);
  assert.equal(context.section, "history");
  assert.equal(context.historyMonth, "2026-09");
  assert.equal(context.historyCategory, "medicine");
});

test("local-mode restoration and sign-out refresh data without returning to the homepage", async () => {
  for (const previousUser of [undefined, "test", null]) {
    const { context, calls } = accountContext("detail", previousUser);
    await context.applyUser(null);
    assert.equal(context.section, "detail");
    assert.equal(context.selectedDate, "2026-09-21");
    assert.equal(calls.includes("navigate"), false);
    assert.equal(calls.includes("reset-history"), previousUser === "test");
  }
});

test("slow cached boot cannot override navigation that happened while local data loaded", async () => {
  const { context, calls } = accountContext("overview");
  let release;
  context.navigationRevision = 0;
  context.localStorage.getItem = () => null;
  context.storage.getProfile = () => new Promise(resolve => { release = resolve; });
  vm.runInContext(source.slice(source.indexOf("async function bootFromCache()"), source.indexOf("async function applyUser(user)")), context);
  const booting = context.bootFromCache();
  context.navigationRevision++;
  context.section = "detail";
  release({});
  await booting;
  assert.equal(context.section, "detail");
  assert.equal(calls.includes("navigate"), false);
});
