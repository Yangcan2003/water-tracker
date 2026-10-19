// Background time is not time spent waiting in the visible interface. In
// particular, a timer queued before iOS suspends the WebView must not cancel a
// finished native reply immediately when the user returns.
export function createForegroundDeadline(milliseconds, expire, {
  lifecycle = globalThis.document, now = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let remaining = milliseconds, started = null, timer = null, stopped = false;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const stop = () => { stopped = true; clear(); lifecycle?.removeEventListener("visibilitychange", update); };
  const arm = () => {
    if (stopped || lifecycle?.hidden) return;
    started = now();
    timer = schedule(() => {
      timer = null;
      if (stopped) return;
      if (lifecycle?.hidden) { started = null; return; }
      stop(); expire();
    }, remaining);
  };
  function update() {
    if (stopped) return;
    if (lifecycle?.hidden) {
      clear();
      if (started !== null) remaining = Math.max(0, remaining - (now() - started));
      started = null;
    } else if (started === null) arm();
  }
  lifecycle?.addEventListener("visibilitychange", update);
  arm();
  return { stop };
}
