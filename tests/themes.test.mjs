import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { THEMES, getTheme, commitThemeChange } from "../js/themes.js";

test("a successful change updates the OS icon, saves the choice, then applies the interface", async () => {
  const events = [];
  await commitThemeChange("jade", {
    currentId: "coral",
    setIcon: async theme => events.push(`icon:${theme.id}`),
    save: async id => events.push(`save:${id}`),
    apply: theme => events.push(`ui:${theme.id}`),
  });
  assert.deepEqual(events, ["icon:jade", "save:jade", "ui:jade"]);
});

test("failed native switches preserve the preference and UI", async () => {
  let saved = false, applied = false;
  await assert.rejects(commitThemeChange("iris", {
    currentId: "coral", setIcon: async () => { throw new Error("device unavailable"); },
    save: async () => { saved = true; }, apply: () => { applied = true; },
  }), /device unavailable/);
  assert.equal(saved, false);
  assert.equal(applied, false);
});

test("persistence failure restores the previous native icon", async () => {
  const icons = [];
  await assert.rejects(commitThemeChange("midnight", {
    currentId: "jade", setIcon: async theme => icons.push(theme.id),
    save: async () => { throw new Error("storage full"); },
    apply: () => assert.fail("must preserve previous UI"),
  }), /storage full/);
  assert.deepEqual(icons, ["midnight", "jade"]);
});

test("unknown selections are rejected and selecting the current theme is a no-op", async () => {
  const callbacks = { currentId: "coral", setIcon: () => assert.fail(), save: () => assert.fail(), apply: () => assert.fail() };
  assert.equal(await commitThemeChange("coral", callbacks), false);
  await assert.rejects(commitThemeChange("__proto__", callbacks), /未知配色/);
  assert.equal(getTheme("invalid").id, "coral");
});

test("each palette has web assets and matching alternate icons in both Xcode configurations", async () => {
  const project = await readFile(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  const swift = await readFile(new URL("../ios/App/App/SceneDelegate.swift", import.meta.url), "utf8");
  for (const theme of THEMES) {
    for (const name of ["icon-192.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
      await access(new URL(`../icons/themes/${theme.id}/${name}`, import.meta.url));
    }
    if (!theme.nativeIcon) continue;
    assert.equal(project.split(theme.nativeIcon).length - 1, 2);
    assert.ok(swift.includes(`"${theme.id}": "${theme.nativeIcon}"`));
    const directory = new URL(`../ios/App/App/Assets.xcassets/${theme.nativeIcon}.appiconset/`, import.meta.url);
    const contents = JSON.parse(await readFile(new URL("Contents.json", directory)));
    assert.equal(contents.images[0].size, "1024x1024");
    await access(new URL(contents.images[0].filename, directory));
  }
});
