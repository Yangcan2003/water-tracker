import test from "node:test";
import assert from "node:assert/strict";
import { assistantViewport } from "../js/assistant-keyboard.js";

test("native keyboard anchors the composer before and after WebView resize without double subtraction", () => {
  const state = { baselineHeight: 932, nativeKeyboardHeight: 346, native: true, focused: true };
  assert.deepEqual(assistantViewport({ ...state, layoutHeight: 932, visualHeight: 932 }), { height: 586, top: 0, keyboard: true });
  assert.deepEqual(assistantViewport({ ...state, layoutHeight: 586, visualHeight: 586 }), { height: 586, top: 0, keyboard: true });
  assert.deepEqual(assistantViewport({ ...state, layoutHeight: 586, visualHeight: 540, visualTop: 46 }), { height: 540, top: 0, keyboard: true });
});
test("browser keyboard follows the visual viewport when iOS pans a focused field", () => {
  assert.deepEqual(assistantViewport({ layoutHeight: 932, visualHeight: 560, visualTop: 110, baselineHeight: 932, focused: true }), { height: 560, top: 110, keyboard: true });
  assert.deepEqual(assistantViewport({ layoutHeight: 932, visualHeight: 932, baselineHeight: 932, focused: false }), { height: 932, top: 0, keyboard: false });
});
