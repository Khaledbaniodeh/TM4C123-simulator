/*
 * Clean wire routing: a new wire's automatic route keeps clear of unrelated
 * pin pads (smart routing at creation time). Wires are drawn through the real
 * UI (click a pin, hover the target, click it) and every drawn route is
 * measured by coordinates against all pin pads. Also covered: the created
 * wire equals its preview; save and reload; undo and redo; rotated and moved
 * parts (an existing route is never recomputed); older diagrams (routing [])
 * and routes a user drew are drawn exactly as before and never rewritten;
 * preview stability and cost per pointer move; before/after screenshots at
 * three viewport sizes.
 */
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const G = 9.6;
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const board = { type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0, rotate: 0, attrs: {} };
const led = (id, left, top, rotate = 0) => ({ type: "led", id, top, left, rotate, attrs: { color: "red" } });
const res = (id, left, top) => ({ type: "resistor", id, top, left, rotate: 0, attrs: { value: "220" } });
const diagram = (parts, connections = []) => JSON.stringify({ version: 1, author: "", editor: "routing-test", parts: [board, ...parts], connections });
const norm = (d) => d?.replace(/\s+/g, " ").trim();

/** The routing audit's crowded circuit: 14 LEDs and 2 resistors around the board, 30 wires from all four headers. */
function crowded() {
  const left = Array.from({ length: 5 }, (_, i) => led(`ledL${i + 1}`, -14 * G, (10 + 7 * i) * G));
  const right = Array.from({ length: 5 }, (_, i) => led(`ledR${i + 1}`, 25 * G, (10 + 7 * i) * G));
  const far = Array.from({ length: 4 }, (_, i) => led(`ledF${i + 1}`, 34 * G, (12 + 8 * i) * G));
  return {
    parts: [...left, ...right, ...far, res("r1", -14 * G, -4 * G), res("r2", 25 * G, -4 * G)],
    wires: [
      ...left.flatMap((p, i) => [[`board1:J1.${i + 1}`, `${p.id}:A`], [`board1:J3.${i + 1}`, `${p.id}:C`]]),
      ...right.flatMap((p, i) => [[`board1:J3.${i + 6}`, `${p.id}:A`], [`board1:J1.${i + 6}`, `${p.id}:C`]]),
      ...far.flatMap((p, i) => [[`board1:J4.${i + 2}`, `${p.id}:A`], [`board1:J2.${i + 2}`, `${p.id}:C`]]),
      ["board1:J4.1", "r2:1"], ["board1:J2.1", "r1:2"],
    ],
  };
}

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept()); // an example replacing a test circuit
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  return errors;
}

async function load(page, text) {
  expect(await page.evaluate((t) => window.__tm4c.load(t), text)).toBe(true);
  await page.evaluate(() => window.__tm4c.workspace.fit());
}

const serialize = (page) => page.evaluate(() => window.__tm4c.serialize());
/** Moves the pointer off the canvas, so no pin tooltip covers a screenshot. */
const pointerAway = (page) => page.mouse.move(4, 4);
const routings = (page) => page.evaluate(() => window.__tm4c.diagram.connections.map((c) => c[3]));

/** Screen centre of a pin, checked to be the element a click there reaches (not covered by anything). */
async function pinCenter(page, endpoint) {
  const hit = await page.evaluate((id) => {
    const [part, pin] = id.split(":");
    const node = document.querySelector(`.pin-anchor[data-part="${CSS.escape(part)}"][data-pin="${CSS.escape(pin)}"]`);
    const r = node.getBoundingClientRect();
    const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const top = document.elementFromPoint(point.x, point.y);
    return { ...point, reachable: top === node, top: top ? `${top.tagName}#${top.id}.${top.getAttribute("class")}` : null };
  }, endpoint);
  expect(hit.reachable, `${endpoint} is clickable (topmost element: ${hit.top})`).toBe(true);
  return { x: hit.x, y: hit.y };
}

/** Draws a wire through the UI; returns the preview over the target pin and the created wire's path. */
async function connect(page, from, to) {
  const a = await pinCenter(page, from);
  await page.mouse.click(a.x, a.y);
  const b = await pinCenter(page, to);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  const preview = await page.locator(".wire-draft").getAttribute("d");
  await page.mouse.click(b.x, b.y);
  const drawn = await page.locator(`.wire[data-from="${from}"][data-to="${to}"] .wire-core`).getAttribute("d", { timeout: 10_000 });
  return { preview, drawn };
}

/** Every drawn wire: its routing, its path, and the unrelated pin pads the path passes over (by coordinates). */
const measure = (page) => page.evaluate((grid) => {
  const ws = window.__tm4c.workspace;
  const pads = [...document.querySelectorAll(".pin-anchor")].map((n) => {
    const id = `${n.dataset.part}:${n.dataset.pin}`;
    return { id, ...ws.pinPosition(id) };
  });
  const dist = (p, a, b) => {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1)));
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
  };
  // Part outlines (not the board), less a band along each edge where pins sit, as the router sees them.
  const inset = grid / 4;
  const bodies = [...document.querySelectorAll(".part:not([data-part='board1']) .part-hitbox")].map((node) => {
    const box = node.getBBox();
    const svg = document.querySelector("#circuitCanvas");
    const toWorld = svg.getScreenCTM().inverse().multiply(node.getScreenCTM());
    const corners = [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(toWorld));
    return { id: node.closest(".part").dataset.part, left: Math.min(corners[0].x, corners[1].x) + inset, right: Math.max(corners[0].x, corners[1].x) - inset, top: Math.min(corners[0].y, corners[1].y) + inset, bottom: Math.max(corners[0].y, corners[1].y) - inset };
  });
  return [...document.querySelectorAll(".wire")].map((w) => {
    const d = w.querySelector(".wire-core").getAttribute("d");
    const points = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const own = new Set([w.dataset.from, w.dataset.to]);
    return {
      wire: `${w.dataset.from}→${w.dataset.to}`,
      routing: window.__tm4c.diagram.connections[Number(w.dataset.wire)][3],
      d,
      bends: points.length - 2,
      aligned: points.every((q, i) => i === 0 || q.x === points[i - 1].x || q.y === points[i - 1].y),
      attached: Math.hypot(points[0].x - ws.pinPosition(w.dataset.from).x, points[0].y - ws.pinPosition(w.dataset.from).y) < 1e-3
        && Math.hypot(points.at(-1).x - ws.pinPosition(w.dataset.to).x, points.at(-1).y - ws.pinPosition(w.dataset.to).y) < 1e-3,
      crossed: pads.filter((p) => !own.has(p.id) && points.some((q, i) => i > 0 && dist(p, points[i - 1], q) < 0.45 * grid)).map((p) => p.id),
      overParts: bodies.filter((r) => points.some((q, i) => i > 0
        && Math.max(q.x, points[i - 1].x) > r.left && Math.min(q.x, points[i - 1].x) < r.right
        && Math.max(q.y, points[i - 1].y) > r.top && Math.min(q.y, points[i - 1].y) < r.bottom)).map((r) => r.id),
    };
  });
}, G);

/**
 * Wires whose drawn path crosses a clickable control (on-board switch or external button cap), in screen
 * space; with `labels`, wires drawn across an on-board switch's silkscreen label (its whole text box) instead.
 */
const coveredControls = (page, labels = false) => page.evaluate((labels) => {
  const inset = labels ? 0 : 2;
  const controls = [...document.querySelectorAll(labels ? ".part .lp-switch .lp-silk" : ".part [data-input], .part .button-cap")].map((node) => {
    const r = node.getBoundingClientRect();
    const name = labels ? `${node.textContent} label` : node.dataset.input ?? node.closest(".part").dataset.part;
    return { name, left: r.left + inset, right: r.right - inset, top: r.top + inset, bottom: r.bottom - inset };
  });
  return [...document.querySelectorAll(".wire .wire-core")].flatMap((path) => {
    const matrix = path.getScreenCTM();
    const points = [...path.getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => new DOMPoint(Number(m[1]), Number(m[2])).matrixTransform(matrix));
    const wire = path.closest(".wire");
    return controls.filter((c) => points.some((q, i) => i > 0
      && Math.max(q.x, points[i - 1].x) > c.left && Math.min(q.x, points[i - 1].x) < c.right
      && Math.max(q.y, points[i - 1].y) > c.top && Math.min(q.y, points[i - 1].y) < c.bottom)).map((c) => `${wire.dataset.from}→${wire.dataset.to} over ${c.name}`);
  });
}, labels);

const padsCrossed = (wires) => wires.reduce((sum, w) => sum + w.crossed.length, 0);
const partsCrossed = (wires) => wires.reduce((sum, w) => sum + w.overParts.length, 0);
const crossings = (wires) => wires.filter((w) => w.crossed.length).map((w) => `${w.wire}: ${w.crossed.join(" ")}`);

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test(`new wires in a crowded circuit cross no unrelated pin pad and match their preview, at ${tag}`, async ({ page }) => {
    const errors = await open(page, size);
    const { parts, wires } = crowded();
    // Before: the same wires as older diagrams store them (routing []), drawn with the default L.
    await load(page, diagram(parts, wires.map(([a, b]) => [a, b, "green", []])));
    const before = await measure(page);
    await pointerAway(page);
    await page.screenshot({ path: `test-results/routing-crowded-before-${tag}.png` });

    // After: the same wires drawn through the UI, one by one.
    await load(page, diagram(parts));
    const mismatched = [];
    for (const [from, to] of wires) {
      const { preview, drawn } = await connect(page, from, to);
      if (norm(preview) !== norm(drawn)) {
        mismatched.push(`${from}→${to}`);
      }
    }
    await expect(page.locator(".wire")).toHaveCount(wires.length);
    await page.locator("#circuitCanvas").press("Escape");
    const after = await measure(page);
    await pointerAway(page);
    await page.screenshot({ path: `test-results/routing-crowded-after-${tag}.png` });
    const summary = {
      wires: wires.length,
      padsCrossed: { before: padsCrossed(before), after: padsCrossed(after) },
      wiresCrossingPads: { before: before.filter((w) => w.crossed.length).length, after: after.filter((w) => w.crossed.length).length },
      bends: { before: before.reduce((s, w) => s + w.bends, 0), after: after.reduce((s, w) => s + w.bends, 0) },
      plainL: after.filter((w) => w.routing.length === 0).length,
      partBodiesCrossed: { before: partsCrossed(before), after: partsCrossed(after) },
    };
    console.log(`::notice title=routing crowded ${tag}::${JSON.stringify(summary)}`);
    await writeFile(`test-results/routing-crowded-${tag}.json`, JSON.stringify({ summary, before, after }, null, 2));

    expect(mismatched, "every created wire equals its preview").toEqual([]);
    expect(padsCrossed(before), "the old default L crosses pads in this circuit").toBeGreaterThan(0);
    expect(crossings(after)).toEqual([]);
    expect(await coveredControls(page, "labels"), "no new wire runs across a switch label").toEqual([]);
    expect(after.every((w) => w.aligned && w.attached)).toBe(true);

    // Saved and loaded again: the same text and the same paths.
    const text = await serialize(page);
    await load(page, text);
    expect(await serialize(page)).toBe(text);
    expect((await measure(page)).map((w) => w.d)).toEqual(after.map((w) => w.d));
    expect(errors).toEqual([]);
  });
}

test("older diagrams (routing []) and routes a user drew are drawn exactly as before and never rewritten", async ({ page }) => {
  const errors = await open(page);
  const { parts, wires } = crowded();
  const userRoute = ["h-19.2", "v-96"];
  const legacy = diagram(parts, [
    ...wires.slice(0, 12).map(([a, b]) => [a, b, "green", []]),
    ["board1:J4.1", "r2:1", "red", userRoute], // a route the user drew by dragging segments
  ]);
  await load(page, legacy);
  const expected = await page.evaluate(async () => {
    const { pathData, routeWire } = await import("/workspace/geometry.js");
    const ws = window.__tm4c.workspace;
    return window.__tm4c.diagram.connections.map(([from, to, , routing]) => pathData(routeWire(ws.pinPosition(from), ws.pinPosition(to), routing)));
  });
  const drawn = await measure(page);
  expect(drawn.map((w) => w.d), "drawn with the same rule as before smart routing").toEqual(expected);
  expect(padsCrossed(drawn), "this older circuit does cross pads; it is shown as saved").toBeGreaterThan(0);
  const saved = await routings(page);
  expect(saved, "loaded as saved").toEqual(JSON.parse(legacy).connections.map((c) => c[3]));

  // Adding new wires (through the UI) and moving a part leave every existing route as saved.
  await connect(page, "board1:J2.7", "r1:1");
  await connect(page, "board1:J3.10", "ledR5:C");
  expect((await routings(page)).slice(0, saved.length)).toEqual(saved);
  expect((await measure(page)).slice(0, saved.length).map((w) => w.d)).toEqual(expected);
  await pointerAway(page);
  await page.screenshot({ path: "test-results/routing-legacy-kept-1280x720.png" });

  // Load, serialize, load again: routing arrays unchanged, including [] and the user's route.
  const text = await serialize(page);
  await load(page, text);
  expect(await routings(page)).toEqual(JSON.parse(text).connections.map((c) => c[3]));
  expect((await routings(page))[12]).toEqual(userRoute);
  expect(errors).toEqual([]);
});

test("a detour wire: preview equals the result, undo and redo restore it exactly, and it survives save and reload", async ({ page }) => {
  const errors = await open(page);
  // The LED sits right of the board, level with its top: the default L from J1.10 would run over J3.10, J4.10, and J2.10.
  await load(page, diagram([led("led1", 22 * G, 1 * G)]));
  const empty = await serialize(page);
  const { preview, drawn } = await connect(page, "board1:J1.10", "led1:A");
  expect(norm(drawn)).toBe(norm(preview));
  const [wire] = await measure(page);
  expect(wire.routing.length, "a detour is stored as routing steps").toBeGreaterThan(0);
  expect(wire.crossed).toEqual([]);
  expect(wire.aligned && wire.attached).toBe(true);
  await pointerAway(page);
  await page.screenshot({ path: "test-results/routing-detour-1280x720.png" });
  const created = await serialize(page);

  await page.locator("#circuitCanvas").press("Control+z");
  await expect(page.locator(".wire")).toHaveCount(0);
  expect(await serialize(page)).toBe(empty);
  await page.locator("#circuitCanvas").press("Control+y");
  await expect(page.locator(".wire")).toHaveCount(1);
  expect(await serialize(page)).toBe(created);
  expect((await measure(page))[0].d).toBe(wire.d);

  await load(page, created);
  expect((await measure(page))[0].d).toBe(wire.d);
  expect(errors).toEqual([]);
});

test("rotated parts get clean routes, and moving or rotating a part never recomputes an existing route", async ({ page }) => {
  const errors = await open(page);
  // A rotated LED has its pins half a grid off the grid; a resistor on the right of the board.
  await load(page, diagram([led("led1", 25 * G, 14 * G, 90), res("r1", 25 * G, 22 * G)]));
  for (const [from, to] of [["board1:J3.5", "led1:A"], ["led1:C", "board1:J2.5"], ["board1:J4.8", "r1:1"], ["r1:2", "board1:J1.9"]]) {
    const { preview, drawn } = await connect(page, from, to);
    expect(norm(drawn), `${from}→${to}`).toBe(norm(preview));
  }
  await page.locator("#circuitCanvas").press("Escape");
  const wires = await measure(page);
  expect(crossings(wires)).toEqual([]);
  expect(wires.every((w) => w.aligned && w.attached)).toBe(true);
  await pointerAway(page);
  await page.screenshot({ path: "test-results/routing-rotated-1280x720.png" });
  const saved = await routings(page);

  // Drag the LED: the wires follow its pins, their stored routes stay as they were.
  const box = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  expect(await routings(page)).toEqual(saved);
  // Rotate it (R): the same.
  await page.locator("#circuitCanvas").press("r");
  expect(await routings(page)).toEqual(saved);
  const moved = await measure(page);
  expect(moved.every((w) => w.aligned && w.attached)).toBe(true);
  expect(errors).toEqual([]);
});

test("the preview follows the pointer deterministically and cheaply", async ({ page }) => {
  const errors = await open(page);
  const { parts, wires } = crowded();
  await load(page, diagram(parts, wires.slice(0, 20).map(([a, b]) => [a, b, "green", []])));
  const a = await pinCenter(page, "board1:J1.10");
  await page.mouse.click(a.x, a.y);
  await expect(page.locator(".wire-draft")).toHaveCount(1);
  const canvas = await page.locator("#circuitCanvas").boundingBox();
  const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  const ring = Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * 2 * Math.PI;
    return { x: centre.x + 0.4 * canvas.width * Math.cos(t), y: centre.y + 0.4 * canvas.height * Math.sin(t) };
  });
  const shapes = [];
  for (const point of ring) {
    await page.mouse.move(point.x, point.y);
    shapes.push(await page.locator(".wire-draft").getAttribute("d"));
  }
  // Revisiting a pointer position gives the same preview (no flicker from history).
  const revisits = [];
  for (const i of [0, 9, 18, 27, 36, 45, 54, 63]) {
    await page.mouse.move(ring[i].x, ring[i].y);
    revisits.push((await page.locator(".wire-draft").getAttribute("d")) === shapes[i]);
  }
  const bends = shapes.map((d) => (d.match(/L/g) ?? []).length - 1);
  const shapeChanges = bends.filter((b, i) => i > 0 && b !== bends[i - 1]).length;

  // Cost per pointer move while wiring (route search and drawing), on fresh pointer positions.
  const cost = await page.evaluate(({ ring }) => {
    const svg = document.querySelector("#circuitCanvas");
    const times = [];
    for (let round = 0; round < 3; round++) {
      for (const p of ring) {
        const t0 = performance.now();
        svg.dispatchEvent(new PointerEvent("pointermove", { clientX: p.x + round * 7, clientY: p.y + round * 5, pointerId: 1, bubbles: true }));
        times.push(performance.now() - t0);
      }
    }
    times.sort((x, y) => x - y);
    return { samples: times.length, medianMs: +times[times.length >> 1].toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3), maxMs: +times.at(-1).toFixed(3) };
  }, { ring });
  const report = { samples: ring.length, shapeChanges, bends: { min: Math.min(...bends), max: Math.max(...bends) }, cost };
  console.log(`::notice title=routing preview::${JSON.stringify(report)}`);
  await writeFile("test-results/routing-preview.json", JSON.stringify(report, null, 2));
  expect(revisits.every(Boolean)).toBe(true);
  expect(cost.p95Ms, "one 60 Hz frame").toBeLessThan(16);
  await page.locator("#circuitCanvas").press("Escape");
  expect(errors).toEqual([]);
});

test("shipped examples store the routes the editor draws: clean, and the same when redrawn through the UI", async ({ page }) => {
  const errors = await open(page);
  const report = {};
  for (const example of ["lcd1602-hello", "external-led-button", "adc-potentiometer"]) {
    await page.selectOption("#exampleSelect", example);
    await expect(page.locator(".wire").first()).toBeVisible();
    await page.evaluate(() => window.__tm4c.workspace.fit());
    const shipped = JSON.parse(await serialize(page));
    const asShipped = await measure(page);
    expect(await coveredControls(page), `${example}: no wire covers SW1, SW2, RESET, or a button`).toEqual([]);
    expect(await coveredControls(page, "labels"), `${example}: no wire runs across the SW1, SW2, or RESET label`).toEqual([]);
    await pointerAway(page);
    await page.screenshot({ path: `test-results/routing-example-${example}-1280x720.png` });
    await page.locator("#circuitCanvas").screenshot({ path: `test-results/routing-example-${example}-canvas.png` });
    // The same parts, every wire drawn again through the UI in file order.
    await load(page, JSON.stringify({ ...shipped, connections: [] }));
    for (const [from, to] of shipped.connections) {
      const { preview, drawn } = await connect(page, from, to);
      expect(norm(drawn), `${example} ${from}→${to}`).toBe(norm(preview));
    }
    await page.locator("#circuitCanvas").press("Escape");
    const redrawn = await measure(page);
    report[example] = {
      wires: redrawn.length,
      padsCrossed: { shipped: padsCrossed(asShipped), redrawn: padsCrossed(redrawn) },
      partBodiesCrossed: { shipped: partsCrossed(asShipped), redrawn: partsCrossed(redrawn) },
      routing: redrawn.map((w) => `${w.wire} ${JSON.stringify(w.routing)}`),
    };
    expect(crossings(asShipped), `${example} as shipped`).toEqual([]);
    expect(crossings(redrawn), `${example} redrawn`).toEqual([]);
    expect(asShipped.filter((w) => w.overParts.length).map((w) => `${w.wire} over ${w.overParts.join(" ")}`), `${example}: no wire over a part`).toEqual([]);
    // The same connections in the same order, and exactly the stored routes.
    expect(JSON.parse(await serialize(page)).connections.map((c) => c.slice(0, 2))).toEqual(shipped.connections.map((c) => c.slice(0, 2)));
    expect(redrawn.map((w) => w.routing), `${example}: shipped routes are the editor's own`).toEqual(shipped.connections.map((c) => c[3]));
  }
  console.log(`::notice title=routing examples::${JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { pads: v.padsCrossed, parts: v.partBodiesCrossed }])))}`);
  await writeFile("test-results/routing-examples.json", JSON.stringify(report, null, 2));
  expect(errors).toEqual([]);
});
