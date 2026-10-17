import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { esc } from "../js/utils.js";
import { avatarCrop, AVATAR_SIZE, prepareAvatar, MAX_AVATAR_FILE_BYTES } from "../js/avatar.js";
import { enabledPlans, enabledSupplements, SCHEDULE_LABELS } from "../js/supplement-plan.js";

test("avatar crop is centered for portrait, landscape and square photos", () => {
  assert.deepEqual(avatarCrop(4032, 3024), { x: 504, y: 0, side: 3024 });
  assert.deepEqual(avatarCrop(3024, 4032), { x: 0, y: 504, side: 3024 });
  assert.deepEqual(avatarCrop(100, 100), { x: 0, y: 0, side: 100 });
  assert.equal(AVATAR_SIZE, 384);
  assert.throws(() => avatarCrop(0, 100));
});

test("avatar picker rejects empty, oversized and non-image files before decoding", async () => {
  await assert.rejects(prepareAvatar({ size: 0 }), /请选择/);
  await assert.rejects(prepareAvatar({ size: MAX_AVATAR_FILE_BYTES + 1 }), /20 MB/);
  await assert.rejects(prepareAvatar({ size: 100, type: "application/pdf" }), /图片文件/);
});

test("disabled and deleted supplements do not return as defaults", () => {
  const plan = [{ name: "维生素C" }, { name: "鱼油", enabled: false }, { name: "镁", enabled: true }];
  assert.deepEqual(enabledSupplements(plan).map(item => item.name), ["维生素C", "镁"]);
  assert.deepEqual(enabledSupplements([]), []);
  assert.equal(plan.length, 3);
  assert.equal(SCHEDULE_LABELS.workout, "仅训练日");
});

test("medicine plans preserve disabled settings and do not restore deleted defaults", () => {
  const plans = [{ name: "EVA", dosage: "1粒", enabled: false }, { name: "药物A", targetCount: 2 }];
  assert.deepEqual(enabledPlans(plans), [plans[1]]);
  assert.equal(plans[0].dosage, "1粒");
  assert.deepEqual(enabledPlans([]), []);
});

test("avatar stays editable without a plus badge", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="accountAvatarButton"[^>]*aria-label="更换头像"/);
  assert.doesNotMatch(html, /avatar-edit-badge/);
});

test("profile text and quoted attributes escape HTML without depending on a browser DOM", () => {
  assert.equal(esc(`<img title="A&B" onload='x'>`), "&lt;img title=&quot;A&amp;B&quot; onload=&#39;x&#39;&gt;");
  assert.equal(esc(175), "175");
  assert.equal(esc(null), "");
});
