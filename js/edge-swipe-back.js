// Keep direction detection independent of the DOM so scrolling and cancelled
// touches can be tested without relying on browser timing.
export class EdgeBackGesture {
  start(x, y, time, width) {
    this.reset();
    if (x < 0 || x > 28 || width <= 0) return false;
    this.origin = { x, y, time };
    this.width = width;
    this.samples = [{ x, time }];
    return true;
  }

  move(x, y, time) {
    if (!this.origin) return null;
    const dx = x - this.origin.x, dy = Math.abs(y - this.origin.y);
    if (!this.dragging) {
      if (Math.max(Math.abs(dx), dy) < 10) return null;
      if (dx <= 0 || dx < dy * 1.3) { this.reset(); return null; }
      this.dragging = true;
    }
    this.distance = Math.max(0, Math.min(dx, this.width));
    this.samples.push({ x, time });
    this.samples = this.samples.filter(sample => time - sample.time <= 100);
    return this.distance;
  }

  finish(time) {
    const recent = this.samples?.filter(sample => time - sample.time <= 100) || [];
    const first = recent[0], last = recent.at(-1);
    const velocity = first && last && last.time > first.time
      ? (last.x - first.x) / (last.time - first.time) : 0;
    const complete = Boolean(this.dragging && (this.distance >= Math.min(130, this.width * 0.32)
      || (this.distance >= 48 && velocity >= 0.45)));
    this.reset();
    return complete;
  }

  reset() {
    this.origin = null;
    this.dragging = false;
    this.distance = 0;
    this.samples = [];
  }
}

export function createEdgeSwipeBack({ surface, isEnabled, createPreview, onBack }) {
  const gesture = new EdgeBackGesture();
  let identifier = null, preview = null, width = 0, timer = null;
  let settling = false, suppressClickUntil = 0, releasePoint = null;
  const interactiveInput = 'input, textarea, select, [contenteditable="true"], [role="slider"]';

  function cancel() {
    clearTimeout(timer);
    surface.removeEventListener("transitionend", settled);
    surface.classList.remove("edge-back-surface", "edge-back-settling");
    surface.style.removeProperty("--edge-back-x");
    document.documentElement.classList.remove("edge-back-active");
    preview?.remove();
    preview = null;
    identifier = null;
    settling = false;
    gesture.reset();
  }

  let shouldReturn = false;
  function settled(event) {
    if (event && (event.target !== surface || event.propertyName !== "transform")) return;
    const goBack = shouldReturn;
    cancel();
    if (goBack && isEnabled()) onBack();
  }

  function settle(complete) {
    if (!preview) { cancel(); return; }
    settling = true;
    identifier = null;
    shouldReturn = complete;
    suppressClickUntil = performance.now() + 350;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { settled(); return; }
    surface.classList.add("edge-back-settling");
    surface.addEventListener("transitionend", settled);
    surface.style.setProperty("--edge-back-x", `${complete ? width : 0}px`);
    preview.style.setProperty("--edge-back-progress", complete ? 1 : 0);
    timer = setTimeout(settled, 240);
  }

  document.addEventListener("touchstart", event => {
    if (settling) return;
    if (event.touches.length !== 1) { if (preview) settle(false); else cancel(); return; }
    if (!isEnabled() || !surface.contains(event.target) || document.querySelector("dialog[open]")
      || event.target.closest(interactiveInput)
      || document.activeElement?.matches(interactiveInput)) return;
    const touch = event.touches[0];
    width = surface.getBoundingClientRect().width;
    if (gesture.start(touch.clientX, touch.clientY, performance.now(), width)) identifier = touch.identifier;
  }, { passive: true });

  document.addEventListener("touchmove", event => {
    if (identifier === null || settling) return;
    if (!isEnabled() || document.querySelector("dialog[open]") || event.touches.length !== 1) {
      if (preview) settle(false); else cancel();
      return;
    }
    const touch = Array.from(event.touches).find(item => item.identifier === identifier);
    if (!touch) return;
    const distance = gesture.move(touch.clientX, touch.clientY, performance.now());
    if (distance === null) return;
    // If the browser has already claimed scrolling, never start a partial drag.
    if (!event.cancelable) { cancel(); return; }
    event.preventDefault();
    if (!preview) {
      preview = createPreview();
      const bounds = surface.getBoundingClientRect();
      preview.classList.add("edge-back-preview");
      preview.style.left = `${bounds.left}px`;
      preview.style.width = `${width}px`;
      preview.inert = true;
      preview.setAttribute("aria-hidden", "true");
      document.body.append(preview);
      surface.classList.add("edge-back-surface");
      document.documentElement.classList.add("edge-back-active");
    }
    surface.style.setProperty("--edge-back-x", `${distance}px`);
    preview.style.setProperty("--edge-back-progress", distance / width);
  }, { passive: false });

  document.addEventListener("touchend", event => {
    if (identifier === null || settling) return;
    const touch = Array.from(event.changedTouches).find(touch => touch.identifier === identifier);
    if (!touch) return;
    releasePoint = { x: touch.clientX, y: touch.clientY };
    if (preview && event.cancelable) event.preventDefault();
    settle(gesture.finish(performance.now()));
  }, { passive: false });
  document.addEventListener("touchcancel", () => { if (!settling) settle(false); }, { passive: true });
  // Suppress only the compatibility click generated by the completed touch.
  document.addEventListener("click", event => {
    if (event.detail && releasePoint && performance.now() < suppressClickUntil
      && Math.hypot(event.clientX - releasePoint.x, event.clientY - releasePoint.y) < 25) {
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("resize", cancel);
  return { cancel };
}
