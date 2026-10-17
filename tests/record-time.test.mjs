import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function editor() {
  const writes = [];
  const input = new EventTarget();
  const dialog = new EventTarget();
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); };
  const form = new EventTarget();
  form.reportValidity = () => true;
  const context = vm.createContext({
    E: { recordTimeDialog: dialog, recordTimeInput: input, recordTimeForm: form, recordTimeSaveButton: {} },
    recordTimeDraft: null, selectedDate: "2026-10-16", storage: { sync: { generation: 1 } },
    fromDateKey: key => new Date(`${key}T00:00:00`),
  });
  vm.runInContext(source.slice(source.indexOf("function handleTimeEditClick("), source.indexOf("// ========== 厕所记录")), context);
  vm.runInContext(source.slice(source.indexOf('E.recordTimeForm.addEventListener("submit"'), source.indexOf('E.historyList.addEventListener("click"')), context);
  context.updateRecordTime = async (...args) => { writes.push(args); return true; };
  const open = (coll = "waterLogs") => context.handleTimeEditClick({ target: { closest: () => ({ dataset: { id: "record-1", coll, time: "08:20" } }) } });
  const submit = () => context.handleRecordTimeSubmit({ preventDefault() {} });
  return { context, input, dialog, writes, open, submit };
}

test("wheel changes and blur never write; cancel discards the selected time", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const e = editor();
  e.open();
  for (const time of ["09:20", "09:45", "10:45"]) {
    e.input.value = time;
    e.input.dispatchEvent(new Event("input"));
    e.input.dispatchEvent(new Event("change"));
    e.input.dispatchEvent(new Event("blur"));
    t.mock.timers.tick(2000);
    assert.equal(e.writes.length, 0);
    assert.equal(e.dialog.open, true);
  }
  e.dialog.close();
  await e.submit();
  assert.equal(e.writes.length, 0);
  e.open();
  assert.equal(e.input.value, "08:20");
});

test("confirmation saves the final time to the original record and date for every supported category", async () => {
  for (const coll of ["waterLogs", "toiletLogs", "medicineLogs", "supplementLogs"]) {
    const e = editor();
    e.open(coll);
    e.input.value = "23:59";
    e.context.selectedDate = "2026-10-17";
    await e.submit();
    assert.equal(e.writes.length, 1);
    const [collection, id, date] = e.writes[0];
    assert.equal(collection, coll);
    assert.equal(id, "record-1");
    assert.equal(date.getDate(), 16);
    assert.equal(date.getHours(), 23);
    assert.equal(date.getMinutes(), 59);
    assert.equal(date.getSeconds(), 0);
    assert.equal(e.dialog.open, false);
  }
});

test("invalid or unchanged times and an account change do not write", async () => {
  for (const time of ["", "25:00", "09:60", "08:20"]) {
    const e = editor(); e.open(); e.input.value = time;
    await e.submit();
    assert.equal(e.writes.length, 0);
  }
  const e = editor(); e.open(); e.input.value = "00:00";
  e.context.storage.sync.generation++;
  await e.submit();
  assert.equal(e.writes.length, 0);
  assert.equal(e.dialog.open, false);
});

test("repeated confirmation writes once; a failed save keeps the draft available to retry", async () => {
  const e = editor(); e.open(); e.input.value = "00:00";
  let finish;
  e.context.updateRecordTime = async (...args) => {
    e.writes.push(args);
    return new Promise(resolve => { finish = resolve; });
  };
  const saving = e.submit();
  await e.submit();
  assert.equal(e.writes.length, 1);
  assert.equal(e.context.E.recordTimeSaveButton.disabled, true);
  finish(false); await saving;
  assert.equal(e.dialog.open, true);
  assert.equal(e.input.value, "00:00");
  assert.equal(e.context.E.recordTimeSaveButton.disabled, false);
  const retry = e.submit(); finish(true); await retry;
  assert.equal(e.writes.length, 2);
  assert.equal(e.dialog.open, false);
});
