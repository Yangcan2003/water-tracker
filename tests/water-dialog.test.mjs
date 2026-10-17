import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const bundled = await build({
  stdin: { contents: 'export { createWaterDialog } from "./js/water-dialog.js";', resolveDir: new URL("../", import.meta.url).pathname },
  bundle: true, write: false, format: "iife", globalName: "WaterDialog",
  plugins: [{ name: "keyboard-fixture", setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/(core|keyboard)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const Capacitor = { getPlatform: () => native ? "ios" : "web" };
      export const Keyboard = {
        addListener: async (event, callback) => { keyboardEvents.set(event, callback); },
        setScroll: async (options) => { scrolling.push(options.isDisabled); }
      };` }));
  } }],
});

function fixture(native = true) {
  const events = new Map(), keyboardEvents = new Map(), scrolling = [], focus = [], properties = new Map(), frames = new Map(), classes = new Set();
  const document = { activeElement: null, documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } } };
  const listen = (event, callback) => { const callbacks = events.get(event) || []; callbacks.push(callback); events.set(event, callbacks); };
  const viewport = { height: 932, offsetTop: 0, addEventListener: listen };
  const window = { innerHeight: 932, innerWidth: 430, visualViewport: viewport, addEventListener: listen };
  let frameId = 0;
  const dialog = { open: false, scrollTop: 0, addEventListener: listen,
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) },
    contains: element => element === input,
    showModal() { this.open = true; },
    getBoundingClientRect: () => ({ top: 71, bottom: Math.min(420, Number.parseFloat(properties.get("--water-viewport-height")) - 24) }),
  };
  const input = { matches: selector => selector === "input", focus(options) { focus.push(options); document.activeElement = this; },
    select() { this.selected = true; }, blur() { document.activeElement = null; },
    getBoundingClientRect: () => ({ top: 270 - dialog.scrollTop, bottom: 320 - dialog.scrollTop }),
  };
  const context = vm.createContext({ native, keyboardEvents, scrolling, window, document,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(bundled.outputFiles[0].text, context);
  const controller = context.WaterDialog.createWaterDialog(dialog, input);
  const emit = event => { for (const callback of events.get(event) || []) callback(); };
  const flush = () => { for (const [id, callback] of frames) { frames.delete(id); callback(); } };
  const close = () => { dialog.open = false; emit("close"); };
  return { controller, dialog, input, window, viewport, properties, keyboardEvents, scrolling, focus, frames, classes, emit, flush, close };
}

test("water amount gets focus and selection in the opening gesture, and closing releases native scrolling", () => {
  const state = fixture();
  state.controller.open();
  assert.equal(state.focus.length, 1);
  assert.equal(state.focus[0].preventScroll, true);
  assert.equal(state.input.selected, true);
  assert.equal(state.properties.get("--water-viewport-height"), "932px");
  assert.deepEqual(state.scrolling, [true]);
  state.emit("resize");
  state.close();
  state.flush();
  assert.equal(state.properties.size, 0);
  assert.equal(state.frames.size, 0);
  assert.equal(state.classes.size, 0);
  assert.deepEqual(state.scrolling, [true, false]);
});

test("iOS keyboard will-show and WebView resize use the same available height; rapid reopening does not subtract twice", () => {
  const state = fixture();
  state.controller.open();
  state.keyboardEvents.get("keyboardWillShow")({ keyboardHeight: 346 }); state.flush();
  assert.equal(state.properties.get("--water-viewport-height"), "586px");
  state.window.innerHeight = state.viewport.height = 586;
  state.emit("resize"); state.flush();
  assert.equal(state.properties.get("--water-viewport-height"), "586px");
  state.close();
  state.keyboardEvents.get("keyboardWillHide")();
  state.controller.open();
  state.keyboardEvents.get("keyboardWillShow")({ keyboardHeight: 346 }); state.flush();
  assert.equal(state.properties.get("--water-viewport-height"), "586px");
  state.close();
  state.window.innerWidth = 844;
  state.window.innerHeight = state.viewport.height = 430;
  state.controller.open();
  state.keyboardEvents.get("keyboardWillShow")({ keyboardHeight: 240 }); state.flush();
  assert.equal(state.properties.get("--water-viewport-height"), "190px");
});

test("a short viewport scrolls only the form to keep the focused amount visible", () => {
  const state = fixture();
  state.controller.open();
  state.keyboardEvents.get("keyboardWillShow")({ keyboardHeight: 672 }); state.flush();
  const bounds = state.dialog.getBoundingClientRect(), field = state.input.getBoundingClientRect();
  assert.ok(state.dialog.scrollTop > 0);
  assert.ok(field.bottom <= bounds.bottom - 12);
  assert.ok(field.top >= bounds.top + 12);
});

test("browser viewport panning is followed without native scrolling changes", () => {
  const state = fixture(false);
  state.controller.open();
  state.viewport.height = 550; state.viewport.offsetTop = 80;
  state.emit("resize"); state.flush();
  assert.equal(state.properties.get("--water-viewport-height"), "550px");
  assert.equal(state.properties.get("--water-viewport-top"), "80px");
  assert.deepEqual(state.scrolling, []);
});
