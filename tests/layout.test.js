/*
 * Layout rules of the application shell (apps/web/layout.js): the code |
 * circuit split and when the inspector starts open. The DOM behaviour is
 * covered by e2e/ux-shell.spec.js.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampSplit, defaultSplit, initialInspector } from "../apps/web/layout.js";

describe("application shell layout", () => {
  it("gives the code pane a third of wide screens and a little more on narrow ones", () => {
    assert.equal(defaultSplit(1920), 34);
    assert.equal(defaultSplit(1280), 34);
    assert.equal(defaultSplit(1024), 36);
  });

  it("keeps the split within 25-65 % and ignores a stored value that is not a number", () => {
    assert.equal(clampSplit(10, 1280), 25);
    assert.equal(clampSplit(90, 1280), 65);
    assert.equal(clampSplit(41.5, 1280), 41.5);
    assert.equal(clampSplit(undefined, 1280), 34);
    assert.equal(clampSplit(Number.NaN, 1024), 36);
    assert.equal(clampSplit("50", 1280), 34);
  });

  it("starts with the inspector closed, unless the user left it open", () => {
    assert.equal(initialInspector({}), false);
    assert.equal(initialInspector({ inspector: false }), false);
    assert.equal(initialInspector({ inspector: true }), true);
    assert.equal(initialInspector({ inspector: "yes" }), false);
  });
});
