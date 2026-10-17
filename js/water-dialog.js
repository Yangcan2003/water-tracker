import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { assistantViewport } from "./assistant-keyboard.js";

// Keep the form anchored while the keyboard resizes/pans the viewport. Focus
// the amount during the tap, rather than moving focus after the modal paints.
export function createWaterDialog(dialog, amount) {
  const native = Capacitor.getPlatform() === "ios";
  let active = false, frame = null, scrollFrame = null, baselineHeight = window.innerHeight, baselineWidth = window.innerWidth, nativeKeyboardHeight = 0;
  const keepInputVisible = () => {
    scrollFrame = null;
    if (!active || !dialog.open) return;
    const input = document.activeElement;
    if (!dialog.contains(input) || !input.matches("input")) return;
    const field = input.getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
    if (field.bottom > bounds.bottom - 12) dialog.scrollTop += field.bottom - bounds.bottom + 12;
    if (field.top < bounds.top + 12) dialog.scrollTop -= bounds.top + 12 - field.top;
  };
  const update = () => {
    frame = null;
    if (!active || !dialog.open) return;
    const viewport = window.visualViewport;
    const input = document.activeElement;
    const focused = dialog.contains(input) && input.matches("input");
    const geometry = assistantViewport({ layoutHeight: window.innerHeight, visualHeight: viewport?.height,
      visualTop: viewport?.offsetTop, baselineHeight, nativeKeyboardHeight, native, focused });
    dialog.style.setProperty("--water-viewport-height", `${geometry.height}px`);
    dialog.style.setProperty("--water-viewport-top", `${geometry.top}px`);
    // Modal scroll ranges can settle one frame after a viewport resize. Keep
    // the focused field visible then too, without scrolling the page itself.
    if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
    keepInputVisible();
    scrollFrame = requestAnimationFrame(keepInputVisible);
  };
  const schedule = () => { if (active && frame == null) frame = requestAnimationFrame(update); };
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  dialog.addEventListener("focusin", schedule);
  if (native) {
    for (const event of ["keyboardWillShow", "keyboardDidShow"]) void Keyboard.addListener(event, info => { nativeKeyboardHeight = info.keyboardHeight; schedule(); }).catch(() => {});
    for (const event of ["keyboardWillHide", "keyboardDidHide"]) void Keyboard.addListener(event, () => { nativeKeyboardHeight = 0; schedule(); }).catch(() => {});
  }
  dialog.addEventListener("close", () => {
    if (!active) return;
    active = false;
    if (dialog.contains(document.activeElement)) document.activeElement.blur();
    if (frame != null) cancelAnimationFrame(frame);
    if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
    frame = null;
    scrollFrame = null;
    document.documentElement.classList.remove("water-dialog-active");
    dialog.style.removeProperty("--water-viewport-height");
    dialog.style.removeProperty("--water-viewport-top");
    if (native) void Keyboard.setScroll({ isDisabled: false }).catch(() => {});
  });
  return {
    open() {
      if (!dialog.open) {
        // A quick reopen can happen before iOS finishes restoring the WebView.
        // Reuse its unoccluded height at this orientation instead of subtracting
        // the keyboard from an already shrunken baseline a second time.
        baselineHeight = baselineWidth === window.innerWidth ? Math.max(baselineHeight, window.innerHeight) : window.innerHeight;
        baselineWidth = window.innerWidth;
        active = true;
        document.documentElement.classList.add("water-dialog-active");
        if (native) void Keyboard.setScroll({ isDisabled: true }).catch(() => {});
        dialog.showModal();
      }
      amount.focus({ preventScroll: true });
      amount.select();
      if (frame != null) cancelAnimationFrame(frame);
      update();
    },
  };
}
