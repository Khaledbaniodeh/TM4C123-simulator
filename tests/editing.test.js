/*
 * Multi-item editing: selection model, pure edit operations, and exact
 * undo/redo through commands.setContent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { History, commands, normalizeDiagram, serializeDiagram } from "../apps/web/workspace/diagram.js";
import { copyItems, moveParts, pasteItems, removeItems } from "../apps/web/workspace/editing.js";
import { sanitizeSelection, selectedParts, selectedWires, selectionOf, toggleItem } from "../apps/web/workspace/selection.js";

function sample() {
  return normalizeDiagram({
    version: 1,
    author: "",
    editor: "tm4c123-simulator",
    parts: [
      { type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0, rotate: 0, attrs: {} },
      { type: "led", id: "led1", top: 100, left: -200, rotate: 0, attrs: { color: "red" } },
      { type: "resistor", id: "r1", top: 160, left: -150, rotate: 90, attrs: { value: "220" } },
      { type: "pushbutton", id: "btn1", top: 220, left: -150, rotate: 0, attrs: {} },
    ],
    connections: [
      ["board1:J1.10", "r1:2", "green", []],
      ["r1:1", "led1:A", "green", ["v-10", "h20"]],
      ["led1:C", "board1:J3.2", "black", []],
      ["board1:J1.9", "btn1:2", "blue", []],
    ],
  });
}

const isBoard = (id) => id === "board1";
const prefixOf = (part) => ({ led: "led", resistor: "r", pushbutton: "btn" })[part.type];

describe("selection model", () => {
  it("normalizes single items and groups", () => {
    assert.equal(selectionOf([], []), null);
    assert.deepEqual(selectionOf(["led1"]), { kind: "part", id: "led1" });
    assert.deepEqual(selectionOf([], [2]), { kind: "wire", index: 2 });
    assert.deepEqual(selectionOf(["led1", "r1", "led1"], [3, 1]), { kind: "group", parts: ["led1", "r1"], wires: [1, 3] });
  });

  it("toggles items with Shift/Ctrl+click and keeps the board out of groups", () => {
    let selection = { kind: "part", id: "led1" };
    selection = toggleItem(selection, { part: "r1" }, isBoard);
    assert.deepEqual(selection, { kind: "group", parts: ["led1", "r1"], wires: [] });
    selection = toggleItem(selection, { wire: 1 }, isBoard);
    assert.deepEqual(selectedWires(selection), [1]);
    selection = toggleItem(selection, { part: "led1" }, isBoard);
    assert.deepEqual(selection, { kind: "group", parts: ["r1"], wires: [1] });
    // Adding the board starts over with just the board.
    assert.deepEqual(toggleItem(selection, { part: "board1" }, isBoard), { kind: "part", id: "board1" });
    // With the board selected, Shift+click selects only the clicked item.
    assert.deepEqual(toggleItem({ kind: "part", id: "board1" }, { part: "led1" }, isBoard), { kind: "part", id: "led1" });
  });

  it("drops items that no longer exist", () => {
    const diagram = sample();
    const selection = { kind: "group", parts: ["led1", "gone"], wires: [0, 9] };
    assert.deepEqual(sanitizeSelection(selection, diagram), { kind: "group", parts: ["led1"], wires: [0] });
    assert.equal(sanitizeSelection({ kind: "part", id: "gone" }, diagram), null);
    assert.equal(sanitizeSelection({ kind: "component", partId: "board1", id: "U1" }, diagram).id, "U1");
  });
});

describe("edit operations", () => {
  it("moves parts without touching wires", () => {
    const diagram = sample();
    const result = moveParts(diagram, ["led1", "r1"], 10, -20);
    assert.deepEqual(result.parts.find((p) => p.id === "led1"), { ...diagram.parts[1], left: -190, top: 80 });
    assert.equal(result.parts.find((p) => p.id === "btn1").left, -150);
    assert.deepEqual(result.connections, diagram.connections);
    assert.equal(diagram.parts[1].left, -200, "input is not mutated");
  });

  it("removes parts with their attached wires plus selected wires", () => {
    const diagram = sample();
    const result = removeItems(diagram, ["r1"], [3]);
    assert.deepEqual(result.parts.map((p) => p.id), ["board1", "led1", "btn1"]);
    assert.deepEqual(result.connections, [["led1:C", "board1:J3.2", "black", []]]);
  });

  it("copies parts with the wires between them only", () => {
    const clipboard = copyItems(sample(), ["led1", "r1"]);
    assert.deepEqual(clipboard.parts.map((p) => p.id), ["led1", "r1"]);
    assert.deepEqual(clipboard.connections, [["r1:1", "led1:A", "green", ["v-10", "h20"]]]);
  });

  it("pastes with fresh ids, rewritten endpoints, and an offset", () => {
    const diagram = sample();
    const result = pasteItems(diagram, copyItems(diagram, ["led1", "r1"]), 30, 30, prefixOf);
    assert.deepEqual(result.newIds, ["led2", "r2"]);
    assert.deepEqual(result.newWires, [4]);
    assert.deepEqual(result.connections[4], ["r2:1", "led2:A", "green", ["v-10", "h20"]]);
    const led2 = result.parts.find((p) => p.id === "led2");
    assert.deepEqual({ left: led2.left, top: led2.top, attrs: led2.attrs }, { left: -170, top: 130, attrs: { color: "red" } });
    assert.equal(diagram.parts.length, 4, "input is not mutated");
  });

  it("setContent undoes and redoes exactly", () => {
    const diagram = sample();
    const original = serializeDiagram(diagram);
    const history = new History(diagram);
    history.execute(commands.setContent("Delete", diagram, removeItems(diagram, ["led1", "r1"], [])));
    history.execute(commands.setContent("Paste", diagram, pasteItems(diagram, { parts: [diagram.parts[1]], connections: [] }, 0, 0, prefixOf)));
    const afterBoth = serializeDiagram(diagram);
    history.undo();
    history.undo();
    assert.equal(serializeDiagram(diagram), original);
    history.redo();
    history.redo();
    assert.equal(serializeDiagram(diagram), afterBoth);
    assert.deepEqual(selectedParts({ kind: "group", parts: ["a"], wires: [] }), ["a"]);
  });
});
