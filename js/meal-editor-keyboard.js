import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { assistantViewport } from "./assistant-keyboard.js";

// A modal needs the visible viewport, including iOS keyboard events before
// WebView resize. Scroll only its body so header/footer and the page stay put.
export function createMealEditorKeyboard(dialog) {
  const native = Capacitor.getPlatform() === "ios";
  const body = dialog.querySelector(".diary-editor-body");
  let active = false, frame = null, baselineHeight = window.innerHeight, nativeKeyboardHeight = 0;
  const update = () => {
    frame = null;
    if (!active || !dialog.open) return;
    const input = document.activeElement;
    const focused = dialog.contains(input) && input.matches("input, textarea");
    const viewport = window.visualViewport;
    const geometry = assistantViewport({ layoutHeight: window.innerHeight, visualHeight: viewport?.height,
      visualTop: viewport?.offsetTop, baselineHeight, nativeKeyboardHeight, native, focused });
    dialog.style.setProperty("--meal-viewport-height", `${geometry.height}px`);
    dialog.style.setProperty("--meal-viewport-top", `${geometry.top}px`);
    dialog.classList.toggle("diary-keyboard-open", geometry.keyboard);
    if (focused) {
      const field = input.getBoundingClientRect(), scrollport = body.getBoundingClientRect();
      if (field.bottom > scrollport.bottom - 12) body.scrollTop += field.bottom - scrollport.bottom + 12;
      if (field.top < scrollport.top + 12) body.scrollTop -= scrollport.top + 12 - field.top;
    }
  };
  const schedule = () => { if (active && frame == null) frame = requestAnimationFrame(update); };
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  dialog.addEventListener("focusin", schedule);
  dialog.addEventListener("focusout", schedule);
  if (native) {
    for (const event of ["keyboardWillShow", "keyboardDidShow"]) void Keyboard.addListener(event, info => { nativeKeyboardHeight = info.keyboardHeight; schedule(); }).catch(() => {});
    for (const event of ["keyboardWillHide", "keyboardDidHide"]) void Keyboard.addListener(event, () => { nativeKeyboardHeight = 0; schedule(); }).catch(() => {});
  }
  return {
    open() {
      baselineHeight = window.innerHeight;
      active = true;
      document.documentElement.classList.add("meal-editor-active");
      if (native) void Keyboard.setScroll({ isDisabled: true }).catch(() => {});
      update();
    },
    close() {
      active = false;
      if (dialog.contains(document.activeElement)) document.activeElement.blur();
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      document.documentElement.classList.remove("meal-editor-active");
      dialog.classList.remove("diary-keyboard-open");
      dialog.style.removeProperty("--meal-viewport-height");
      dialog.style.removeProperty("--meal-viewport-top");
      if (native) void Keyboard.setScroll({ isDisabled: false }).catch(() => {});
    },
  };
}
