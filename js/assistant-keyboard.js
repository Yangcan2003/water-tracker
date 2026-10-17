import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

export function assistantViewport({ layoutHeight, visualHeight, visualTop = 0, baselineHeight, nativeKeyboardHeight = 0, native = false, focused = false }) {
  const available = Math.max(1, Math.min(layoutHeight, visualHeight || layoutHeight));
  const height = native && nativeKeyboardHeight > 0 ? Math.min(available, Math.max(1, baselineHeight - nativeKeyboardHeight)) : available;
  return { height, top: native ? 0 : Math.max(0, visualTop), keyboard: nativeKeyboardHeight > 0 || (focused && baselineHeight - available > 140) };
}

export function createAssistantKeyboard(root, input, conversation) {
  const native = Capacitor.getPlatform() === "ios", shell = root.closest(".app-shell"), intro = root.querySelector("#assistantIntro");
  let active = false, nativeKeyboardHeight = 0, baselineHeight = window.innerHeight, frame, welcomeWidth = null;
  const anchorWelcome = () => {
    if (!active || !intro || intro.hidden) return;
    if (welcomeWidth === window.innerWidth) return;
    root.style.removeProperty("--assistant-intro-offset");
    const offset = Math.max(0, intro.getBoundingClientRect().top - conversation.getBoundingClientRect().top + conversation.scrollTop);
    root.style.setProperty("--assistant-intro-offset", `${offset}px`);
    welcomeWidth = window.innerWidth;
  };
  const nativeScroll = disabled => {
    if (!native) return;
    void Keyboard.setScroll({ isDisabled: disabled }).catch(() => {});
    void Keyboard.setAccessoryBarVisible({ isVisible: !disabled }).catch(() => {});
  };
  const update = () => {
    frame = null;
    if (!active || root.hidden) return;
    const viewport = window.visualViewport, focused = document.activeElement === input;
    const atBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 64;
    if (!focused && !nativeKeyboardHeight) baselineHeight = window.innerHeight;
    const geometry = assistantViewport({ layoutHeight: window.innerHeight, visualHeight: viewport?.height, visualTop: viewport?.offsetTop, baselineHeight, nativeKeyboardHeight, native, focused });
    shell.style.setProperty("--assistant-viewport-height", `${geometry.height}px`);
    shell.style.setProperty("--assistant-viewport-top", `${geometry.top}px`);
    document.body.classList.toggle("assistant-keyboard", geometry.keyboard);
    shell.scrollTop = 0;
    anchorWelcome();
    // The welcome is anchored to its resting position, not the bottom of a
    // shrinking viewport. Only actual conversations follow the newest message.
    if (atBottom && (!intro || intro.hidden)) conversation.scrollTop = conversation.scrollHeight;
  };
  const schedule = () => { if (frame == null) frame = requestAnimationFrame(update); };
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  input.addEventListener("focus", () => { anchorWelcome(); if (!nativeKeyboardHeight) baselineHeight = window.innerHeight; schedule(); });
  input.addEventListener("blur", schedule);
  if (native) {
    // Native resize changes innerHeight too. Only real keyboard events reliably
    // distinguish it from an ordinary viewport resize, including Chinese IMEs.
    for (const event of ["keyboardWillShow", "keyboardDidShow"]) void Keyboard.addListener(event, info => { nativeKeyboardHeight = info.keyboardHeight; schedule(); }).catch(() => {});
    for (const event of ["keyboardWillHide", "keyboardDidHide"]) void Keyboard.addListener(event, () => { nativeKeyboardHeight = 0; schedule(); }).catch(() => {});
  }
  return {
    open() { active = true; document.documentElement.classList.add("assistant-page-active"); baselineHeight = Math.max(baselineHeight, window.innerHeight); shell.scrollTop = 0; window.scrollTo(0, 0); nativeScroll(true); update(); },
    contentChanged() { schedule(); },
    close() {
      active = false;
      if (root.contains(document.activeElement)) document.activeElement.blur();
      if (frame != null) cancelAnimationFrame(frame); frame = null;
      document.documentElement.classList.remove("assistant-page-active"); document.body.classList.remove("assistant-keyboard");
      welcomeWidth = null; root.style.removeProperty("--assistant-intro-offset");
      shell.style.removeProperty("--assistant-viewport-height"); shell.style.removeProperty("--assistant-viewport-top"); nativeScroll(false);
    },
  };
}
