import test from "node:test";
import assert from "node:assert/strict";
import { EdgeBackGesture } from "../js/edge-swipe-back.js";

test("only a rightward swipe from the left edge claims navigation", () => {
  const gesture = new EdgeBackGesture();
  assert.equal(gesture.start(29, 100, 0, 400), false);
  gesture.start(12, 100, 0, 400);
  assert.equal(gesture.move(14, 125, 20), null);
  assert.equal(gesture.move(200, 125, 40), null);
  assert.equal(gesture.finish(45), false);
  gesture.start(12, 100, 0, 400);
  assert.equal(gesture.move(0, 100, 20), null);
  assert.equal(gesture.finish(30), false);
  gesture.start(12, 100, 0, 400);
  assert.equal(gesture.move(18, 102, 10), null);
  assert.equal(gesture.move(80, 110, 50), 68);
});

test("distance completes a slow swipe and a short slow swipe snaps back", () => {
  const gesture = new EdgeBackGesture();
  gesture.start(10, 100, 0, 400);
  gesture.move(145, 100, 500);
  assert.equal(gesture.finish(700), true);
  gesture.start(10, 100, 0, 400);
  gesture.move(100, 100, 500);
  assert.equal(gesture.finish(700), false);
});

test("a deliberate flick completes, but a tiny flick or paused swipe does not", () => {
  const gesture = new EdgeBackGesture();
  gesture.start(10, 100, 0, 400);
  gesture.move(35, 100, 20);
  gesture.move(80, 100, 60);
  assert.equal(gesture.finish(65), true);
  gesture.start(10, 100, 0, 400);
  gesture.move(40, 100, 20);
  assert.equal(gesture.finish(25), false);
  gesture.start(10, 100, 0, 400);
  gesture.move(90, 100, 30);
  assert.equal(gesture.finish(300), false);
});

test("reversing or cancelling a gesture cannot accidentally return", () => {
  const gesture = new EdgeBackGesture();
  gesture.start(10, 100, 0, 400);
  gesture.move(180, 100, 50);
  gesture.move(60, 100, 120);
  assert.equal(gesture.finish(125), false);
  gesture.start(10, 100, 0, 400);
  gesture.move(250, 100, 50);
  gesture.reset();
  assert.equal(gesture.finish(60), false);
  assert.equal(gesture.move(300, 100, 70), null);
});

test("drag distance is clamped to the viewport width", () => {
  const gesture = new EdgeBackGesture();
  gesture.start(0, 100, 0, 320);
  assert.equal(gesture.move(500, 100, 500), 320);
  assert.equal(gesture.finish(700), true);
});
