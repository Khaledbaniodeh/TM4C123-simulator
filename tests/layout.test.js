/*
 * Layout rules of the application shell (apps/web/layout.js): the code |
 * circuit split and when the inspector starts open. The DOM behaviour is
 * covered by e2e/ux-shell.spec.js.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSPECTOR_OPEN_WIDTH, clampSplit, defaultSplit, initialInspector } from "../apps/web/layout.js";

describe("application shell layout", () => {
  it("gives the code pane a third of wide screens and a little more on narrow ones", () => {
    assert.equal(defaultSplit(1920), 34);
    assert.equal(defaultSplit(1280), 34);
    assert.equal(defaultSplit(1024), 38);
  });

  it("keeps the split within 25-65 % and ignores a stored value that is not a number", () => {
    assert.equal(clampSplit(10, 1280), 25);
    assert.equal(clampSplit(90, 1280), 65);
    assert.equal(clampSplit(41.5, 1280), 41.5);
    assert.equal(clampSplit(undefined, 1280), 34);
    assert.equal(clampSplit(Number.NaN, 1024), 38);
    assert.equal(clampSplit("50", 1280), 34);
  });

  it("opens the inspector by default from 1280 px, and otherwise follows the user's last choice", () => {
    assert.equal(INSPECTOR_OPEN_WIDTH, 1280);
    assert.equal(initialInspector({}, 1920), true);
    assert.equal(initialInspector({}, 1280), true);
    assert.equal(initialInspector({}, 1024), false);
    assert.equal(initialInspector({ inspector: false }, 1920), false);
    assert.equal(initialInspector({ inspector: true }, 1024), true);
    assert.equal(initialInspector({ inspector: "yes" }, 1024), false);
  });
});
