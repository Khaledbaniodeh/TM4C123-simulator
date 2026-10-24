/*
 * Draft persistence of the student's work (apps/web/draft-store.js): source
 * and circuit drafts round-trip, circuit drafts written before the source
 * draft existed still load, unreadable drafts are set aside instead of
 * overwritten, and missing or full storage is reported, never hidden.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIAGRAM_KEY, DraftStore, SOURCE_KEY, compareWork, parseSourceDraft } from "../apps/web/draft-store.js";
import { CATALOG } from "../apps/web/workspace/parts.js";
import { createDiagram, parseDiagram, serializeDiagram } from "../apps/web/workspace/diagram.js";

/** A Storage stand-in; `refuse(key)` makes setItem throw like a full or blocked browser storage. */
function memoryStorage({ refuse = () => false, unreadable = false } = {}) {
  const items = new Map();
  return {
    items,
    getItem(key) {
      if (unreadable) {
        throw new DOMException("blocked", "SecurityError");
      }
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      if (refuse(key)) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      items.set(key, String(value));
    },
    removeItem(key) {
      items.delete(key);
    },
  };
}

const parse = (text) => parseDiagram(text, CATALOG);

function circuitWithLed() {
  const diagram = createDiagram({ author: "" });
  diagram.parts.push({ type: "led", id: "led1", top: 96, left: -96, rotate: 90, attrs: { color: "red" } });
  diagram.connections.push(["board1:J1.10", "led1:A", "green", []]);
  return diagram;
}

describe("draft store", () => {
  it("round-trips the edited source, its example, and the circuit", () => {
    const storage = memoryStorage();
    const store = new DraftStore(storage);
    assert.equal(store.status, "idle");
    const text = serializeDiagram(circuitWithLed());
    assert.equal(store.saveDiagram(text), true);
    assert.equal(store.saveSource({ exampleId: "gpiof-red-led", source: "int main(void) { for (;;); }\n" }), true);
    assert.equal(store.status, "saved");

    const read = new DraftStore(storage).read(parse);
    assert.deepEqual(read.unreadable, []);
    assert.deepEqual(read.source, { exampleId: "gpiof-red-led", source: "int main(void) { for (;;); }\n" });
    assert.equal(serializeDiagram(read.diagram), text);
  });

  it("stores an unedited example as its id only (null source)", () => {
    const storage = memoryStorage();
    new DraftStore(storage).saveSource({ exampleId: "systick-blink", source: null });
    assert.deepEqual(new DraftStore(storage).read(parse).source, { exampleId: "systick-blink", source: null });
  });

  it("still reads a circuit draft saved before source drafts existed (same key, same format)", () => {
    const storage = memoryStorage();
    const legacy = serializeDiagram(circuitWithLed());
    storage.setItem("tm4c123-simulator:diagram-draft", legacy);
    assert.equal(DIAGRAM_KEY, "tm4c123-simulator:diagram-draft");
    const read = new DraftStore(storage).read(parse);
    assert.equal(read.source, null);
    assert.deepEqual(read.unreadable, []);
    assert.equal(serializeDiagram(read.diagram), legacy);
  });

  it("sets unreadable drafts aside instead of overwriting them", () => {
    const storage = memoryStorage();
    storage.setItem(DIAGRAM_KEY, "{ not json");
    storage.setItem(SOURCE_KEY, JSON.stringify({ version: 99, exampleId: "x", source: "y" }));
    const read = new DraftStore(storage).read(parse);
    assert.equal(read.diagram, null);
    assert.equal(read.source, null);
    assert.deepEqual(read.unreadable, ["circuit", "source"]);
    assert.equal(storage.getItem(`${DIAGRAM_KEY}:unreadable`), "{ not json");
    assert.match(storage.getItem(`${SOURCE_KEY}:unreadable`), /"version":99/);
    assert.equal(storage.getItem(DIAGRAM_KEY), null);
    assert.equal(storage.getItem(SOURCE_KEY), null);
  });

  it("rejects malformed source drafts", () => {
    assert.equal(parseSourceDraft("[]"), null);
    assert.equal(parseSourceDraft(JSON.stringify({ version: 1, exampleId: 3, source: "a" })), null);
    assert.equal(parseSourceDraft(JSON.stringify({ version: 1, exampleId: "a", source: 4 })), null);
    assert.deepEqual(parseSourceDraft(JSON.stringify({ version: 1, exampleId: null, source: "" })), { exampleId: null, source: "" });
  });

  it("reports missing storage and never claims a save", () => {
    const store = new DraftStore(null);
    assert.equal(store.status, "unavailable");
    assert.equal(store.saveDiagram("{}"), false);
    assert.equal(store.saveSource({ exampleId: null, source: "x" }), false);
    assert.equal(store.status, "unavailable");
    assert.deepEqual(store.read(parse), { diagram: null, source: null, unreadable: [] });
  });

  it("reports a refused write until that draft is written again", () => {
    let full = true;
    const storage = memoryStorage({ refuse: (key) => full && key === SOURCE_KEY });
    const store = new DraftStore(storage);
    assert.equal(store.saveDiagram("{}"), true);
    assert.equal(store.saveSource({ exampleId: "a", source: "x" }), false);
    assert.equal(store.status, "failed", "one refused draft is enough to report failure");
    assert.equal(store.lastError.name, "QuotaExceededError");
    assert.equal(store.saveDiagram("{}"), true);
    assert.equal(store.status, "failed", "a later save of the other draft does not hide it");
    full = false;
    assert.equal(store.saveSource({ exampleId: "a", source: "x" }), true);
    assert.equal(store.status, "saved");
  });

  it("survives storage that throws on read", () => {
    const store = new DraftStore(memoryStorage({ unreadable: true }));
    assert.deepEqual(store.read(parse), { diagram: null, source: null, unreadable: [] });
  });
});

describe("work changes", () => {
  const baseline = { source: "a", diagramText: serializeDiagram(createDiagram({ author: "" })) };

  it("tells source and circuit edits apart, and an untouched example has none", () => {
    assert.deepEqual(compareWork({ ...baseline }, baseline), { source: false, circuit: false });
    assert.deepEqual(compareWork({ ...baseline, source: "b" }, baseline), { source: true, circuit: false });
    assert.deepEqual(compareWork({ ...baseline, diagramText: serializeDiagram(circuitWithLed()) }, baseline), { source: false, circuit: true });
  });

  it("an edit that is undone is no change (the serialized circuit is canonical)", () => {
    const diagram = createDiagram({ author: "" });
    diagram.parts.push({ type: "led", id: "led1", top: 0, left: 0, rotate: 0, attrs: {} });
    diagram.parts.pop();
    assert.deepEqual(compareWork({ source: "a", diagramText: serializeDiagram(diagram) }, baseline), { source: false, circuit: false });
  });
});
