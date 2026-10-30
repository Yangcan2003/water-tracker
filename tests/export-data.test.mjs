import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const nativeSource = (await readFile(new URL("../js/native.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const exportSource = appSource.slice(appSource.indexOf("async function exportData() {"), appSource.indexOf("// ========== i18n"));

function setup({ native = true, share = async () => ({ activityType: "saveToFiles" }), write } = {}) {
  const calls = { downloads: 0, closed: 0, toasts: [], writes: [], shares: [] };
  const context = vm.createContext({
    Capacitor: { isNativePlatform: () => native },
    Filesystem: { writeFile: async options => {
      calls.writes.push(options);
      return write ? write(options) : { uri: "file:///cache/backup.json" };
    } },
    Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" },
    Share: { share: async options => { calls.shares.push(options); return share(options); } },
    localStorage: { getItem: () => JSON.stringify({ records: { "2026-10-15": { meal: [{ id: "meal-1" }] } } }) },
    storage: { createBackup: async () => ({ format: "health-tracker-backup", version: 2, data: { records: { "2026-10-15": { meal: [{ id: "meal-1", photos: ["data:image/jpeg;base64,test"] }] } } } }) },
    toFriendlyError: error => error.message,
    toDateKey: () => "2026-10-15",
    showToast: message => calls.toasts.push(message),
    E: { profileDialog: { close: () => calls.closed++ } },
    Blob,
    URL: { createObjectURL: () => "blob:backup", revokeObjectURL: () => {} },
    document: { createElement: () => ({ click: () => calls.downloads++ }) },
  });
  vm.runInContext(`${nativeSource}\n${exportSource}`, context);
  return { calls, run: () => context.exportData() };
}

test("dismissing the iOS share sheet does not download or report success", async () => {
  const { calls, run } = setup({ share: async () => { throw new Error("Share canceled"); } });
  await run();
  assert.equal(calls.shares.length, 1);
  assert.equal(calls.downloads, 0);
  assert.equal(calls.closed, 0);
  assert.deepEqual(calls.toasts, []);
});

test("export waits for native completion before reporting success", async () => {
  let complete;
  const { calls, run } = setup({ share: () => new Promise(resolve => { complete = resolve; }) });
  const pending = run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.shares.length, 1);
  assert.deepEqual(calls.toasts, []);
  assert.equal(calls.closed, 0);
  complete({ activityType: "saveToFiles" });
  await pending;
  assert.deepEqual(calls.toasts, ["数据已导出"]);
  assert.equal(calls.closed, 1);
  assert.equal(calls.downloads, 0);
  const data = JSON.parse(calls.writes[0].data);
  assert.deepEqual(data.data.records["2026-10-15"].meal[0].photos, ["data:image/jpeg;base64,test"]);
});

for (const failure of ["write", "share"]) {
  test(`native ${failure} failure reports an error without falling back to download`, async () => {
    const fail = async () => { throw new Error("Export failed"); };
    const { calls, run } = setup(failure === "write" ? { write: fail } : { share: fail });
    await run();
    assert.match(calls.toasts[0], /^导出失败：/);
    assert.equal(calls.downloads, 0);
    assert.equal(calls.closed, 0);
    if (failure === "write") assert.equal(calls.shares.length, 0);
  });
}

test("web download does not claim the file has already been saved", async () => {
  const { calls, run } = setup({ native: false });
  await run();
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.shares.length, 0);
  assert.equal(calls.downloads, 1);
  assert.deepEqual(calls.toasts, ["已发起下载，请确认文件已保存"]);
});
