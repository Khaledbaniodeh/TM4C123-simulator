/*
 * VERIFICATION ONLY (not for merge): before/after visual evidence for the
 * routing change in PR #26, from its final commit. For each circuit and each
 * supported viewport, the same parts and connections are drawn with the old
 * default L routes ("before", routing []) and with the final routes ("after":
 * the shipped example routes, or wires drawn through the UI). The canvas
 * screenshots are composed side by side with measurements a reader cares
 * about: unrelated pads crossed, wires over parts and over switches, bends,
 * length, wire-wire crossings, parallel overlaps. JSON per composite.
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
const led = (id, left, top) => ({ type: "led", id, top, left, rotate: 0, attrs: { color: "red" } });
const res = (id, left, top) => ({ type: "resistor", id, top, left, rotate: 0, attrs: { value: "220" } });

function crowded() {
  const left = Array.from({ length: 5 }, (_, i) => led(`ledL${i + 1}`, -14 * G, (10 + 7 * i) * G));
  const right = Array.from({ length: 5 }, (_, i) => led(`ledR${i + 1}`, 25 * G, (10 + 7 * i) * G));
  const far = Array.from({ length: 4 }, (_, i) => led(`ledF${i + 1}`, 34 * G, (12 + 8 * i) * G));
  return {
    parts: [board, ...left, ...right, ...far, res("r1", -14 * G, -4 * G), res("r2", 25 * G, -4 * G)],
    wires: [
      ...left.flatMap((p, i) => [[`board1:J1.${i + 1}`, `${p.id}:A`], [`board1:J3.${i + 1}`, `${p.id}:C`]]),
      ...right.flatMap((p, i) => [[`board1:J3.${i + 6}`, `${p.id}:A`], [`board1:J1.${i + 6}`, `${p.id}:C`]]),
      ...far.flatMap((p, i) => [[`board1:J4.${i + 2}`, `${p.id}:A`], [`board1:J2.${i + 2}`, `${p.id}:C`]]),
      ["board1:J4.1", "r2:1"], ["board1:J2.1", "r1:2"],
    ],
  };
}

async function open(page, size) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
}

const serialize = (page) => page.evaluate(() => window.__tm4c.serialize());
async function load(page, text) {
  expect(await page.evaluate((t) => window.__tm4c.load(t), text)).toBe(true);
  await page.evaluate(() => window.__tm4c.workspace.fit());
  await page.mouse.move(2, 2);
}

async function pinCenter(page, endpoint) {
  const hit = await page.evaluate((id) => {
    const [part, pin] = id.split(":");
    const node = document.querySelector(`.pin-anchor[data-part="${CSS.escape(part)}"][data-pin="${CSS.escape(pin)}"]`);
    const r = node.getBoundingClientRect();
    const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    return { ...point, reachable: document.elementFromPoint(point.x, point.y) === node };
  }, endpoint);
  expect(hit.reachable, endpoint).toBe(true);
  return hit;
}

async function connect(page, from, to) {
  const a = await pinCenter(page, from);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(2, 2);
  const b = await pinCenter(page, to);
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.click(b.x, b.y);
  await expect(page.locator(`.wire[data-from="${from}"][data-to="${to}"]`)).toHaveCount(1);
  await page.mouse.move(2, 2);
}

/** Measurements of the drawn wires, in world units (1 grid = 9.6). */
const measure = (page) => page.evaluate((grid) => {
  const ws = window.__tm4c.workspace;
  const svg = document.querySelector("#circuitCanvas");
  const toWorld = (node) => svg.getScreenCTM().inverse().multiply(node.getScreenCTM());
  const boxOf = (node, inset) => {
    const b = node.getBBox();
    const m = toWorld(node);
    const [p, q] = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    return { left: Math.min(p.x, q.x) + inset, right: Math.max(p.x, q.x) - inset, top: Math.min(p.y, q.y) + inset, bottom: Math.max(p.y, q.y) - inset };
  };
  const pads = [...document.querySelectorAll(".pin-anchor")].map((n) => ({ id: `${n.dataset.part}:${n.dataset.pin}`, ...ws.pinPosition(`${n.dataset.part}:${n.dataset.pin}`) }));
  const parts = [...document.querySelectorAll(".part:not([data-part='board1']) .part-hitbox")].map((n) => ({ id: n.closest(".part").dataset.part, ...boxOf(n, grid / 4) }));
  const controls = [...document.querySelectorAll(".part [data-input], .part .button-cap")].map((n) => ({ id: n.dataset.input ?? `${n.closest(".part").dataset.part} cap`, ...boxOf(n, 0.5) }));
  const dist = (p, a, b) => {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1)));
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
  };
  const through = (points, r) => points.some((q, i) => i > 0
    && Math.max(q.x, points[i - 1].x) > r.left && Math.min(q.x, points[i - 1].x) < r.right
    && Math.max(q.y, points[i - 1].y) > r.top && Math.min(q.y, points[i - 1].y) < r.bottom);
  const wires = [...document.querySelectorAll(".wire")].map((w) => {
    const points = [...w.querySelector(".wire-core").getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const own = new Set([w.dataset.from, w.dataset.to]);
    const length = points.reduce((s, q, i) => s + (i ? Math.abs(q.x - points[i - 1].x) + Math.abs(q.y - points[i - 1].y) : 0), 0);
    const direct = Math.abs(points.at(-1).x - points[0].x) + Math.abs(points.at(-1).y - points[0].y);
    return {
      name: `${w.dataset.from}→${w.dataset.to}`,
      ends: own,
      points,
      bends: points.length - 2,
      length,
      direct,
      pads: pads.filter((p) => !own.has(p.id) && points.some((q, i) => i > 0 && dist(p, points[i - 1], q) < 0.45 * grid)).map((p) => p.id),
      parts: parts.filter((r) => through(points, r)).map((r) => r.id),
      controls: controls.filter((r) => through(points, r)).map((r) => r.id),
    };
  });
  const segments = (w) => w.points.slice(1).map((q, i) => [w.points[i], q]);
  let crossings = 0;
  let overlap = 0;
  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) {
      for (const [a, b] of segments(wires[i])) {
        for (const [c, d] of segments(wires[j])) {
          const h1 = a.y === b.y;
          const h2 = c.y === d.y;
          if (h1 !== h2) {
            const [h, v] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
            const x = v[0].x;
            const y = h[0].y;
            const inside = (lo, hi, t) => t > Math.min(lo, hi) + 1e-6 && t < Math.max(lo, hi) - 1e-6;
            if (inside(h[0].x, h[1].x, x) && inside(v[0].y, v[1].y, y)) {
              crossings++;
            }
          } else if (h1 ? Math.abs(a.y - c.y) < 0.45 * grid : Math.abs(a.x - c.x) < 0.45 * grid) {
            const [p1, p2, q1, q2] = h1 ? [a.x, b.x, c.x, d.x] : [a.y, b.y, c.y, d.y];
            overlap += Math.max(0, Math.min(Math.max(p1, p2), Math.max(q1, q2)) - Math.max(Math.min(p1, p2), Math.min(q1, q2)));
          }
        }
      }
    }
  }
  const round = (v) => Math.round(v * 10) / 10;
  return {
    wires: wires.length,
    padsCrossed: wires.reduce((s, w) => s + w.pads.length, 0),
    wiresOverPads: wires.filter((w) => w.pads.length).length,
    wiresOverParts: wires.filter((w) => w.parts.length).length,
    wiresOverControls: wires.filter((w) => w.controls.length).map((w) => `${w.name} over ${w.controls.join(", ")}`),
    bends: wires.reduce((s, w) => s + w.bends, 0),
    maxBends: Math.max(0, ...wires.map((w) => w.bends)),
    lengthGrid: round(wires.reduce((s, w) => s + w.length, 0) / grid),
    detour: round(wires.reduce((s, w) => s + w.length, 0) / Math.max(1, wires.reduce((s, w) => s + w.direct, 0))),
    wireCrossings: crossings,
    parallelOverlapGrid: round(overlap / grid),
  };
}, G);

async function canvasShot(page) {
  return (await page.locator("#circuitCanvas").screenshot()).toString("base64");
}

/** Composes before/after canvases side by side with their measurements, and saves PNG + JSON. */
async function compose(page, name, tag, before, after, note) {
  const rows = [
    ["Unrelated pads crossed (look like connections)", "padsCrossed"],
    ["Wires drawn over a pad", "wiresOverPads"],
    ["Wires over a part body", "wiresOverParts"],
    ["Wires over SW1 / SW2 / RESET / a button", (m) => m.wiresOverControls.length],
    ["Bends (total / most on one wire)", (m) => `${m.bends} / ${m.maxBends}`],
    ["Total length (grid)", "lengthGrid"],
    ["Length ÷ shortest possible", "detour"],
    ["Wire-wire crossings", "wireCrossings"],
    ["Parallel overlap (grid)", "parallelOverlapGrid"],
  ];
  const cell = (m, key) => (typeof key === "function" ? key(m) : m[key]);
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:14px;background:#0d1117;color:#c9d1d9;font:13px system-ui,sans-serif">
    <div style="font-size:16px;font-weight:600;margin-bottom:8px">${name} — ${tag} — PR #26 final commit cbe7d5a</div>
    <div style="display:flex;gap:14px;align-items:flex-start">
      <figure style="margin:0"><figcaption style="margin-bottom:4px;color:#ff7b72">BEFORE: old default L routes (routing [])</figcaption><img style="border:1px solid #30363d;max-width:${tag.startsWith("1920") ? 900 : 640}px" src="data:image/png;base64,${before.image}"></figure>
      <figure style="margin:0"><figcaption style="margin-bottom:4px;color:#56d364">AFTER: final routes</figcaption><img style="border:1px solid #30363d;max-width:${tag.startsWith("1920") ? 900 : 640}px" src="data:image/png;base64,${after.image}"></figure>
    </div>
    <table style="margin-top:10px;border-collapse:collapse">
      <tr><th style="text-align:left;padding:3px 10px">Measure</th><th style="padding:3px 10px">Before</th><th style="padding:3px 10px">After</th></tr>
      ${rows.map(([label, key]) => `<tr><td style="padding:3px 10px;border-top:1px solid #30363d">${label}</td><td style="padding:3px 10px;border-top:1px solid #30363d;text-align:center">${cell(before.metrics, key)}</td><td style="padding:3px 10px;border-top:1px solid #30363d;text-align:center">${cell(after.metrics, key)}</td></tr>`).join("")}
    </table>
    <div style="margin-top:8px;color:#8b949e">${note}</div></body>`;
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1900, height: 900 });
  await sheet.setContent(html);
  const file = `visual-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${tag}`;
  await sheet.screenshot({ path: `test-results/${file}.png`, fullPage: true });
  await sheet.close();
  await writeFile(`test-results/${file}.json`, JSON.stringify({ name, tag, before: before.metrics, after: after.metrics }, null, 2));
  console.log(`::notice title=${file}::${JSON.stringify({ before: before.metrics, after: after.metrics })}`);
}

const withRouting = (text, routing) => {
  const d = JSON.parse(text);
  d.connections = d.connections.map((c, i) => [c[0], c[1], c[2], routing === "legacy" ? [] : routing[i]]);
  return JSON.stringify(d);
};

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;

  test(`shipped examples before/after at ${tag}`, async ({ page }) => {
    await open(page, size);
    for (const [id, name] of [["external-led-button", "Example F"], ["lcd1602-hello", "Example L LCD1602"], ["adc-potentiometer", "Example M potentiometer"]]) {
      await page.selectOption("#exampleSelect", id);
      await expect(page.locator(".wire").first()).toBeVisible();
      const shipped = await serialize(page);
      await load(page, withRouting(shipped, "legacy"));
      const before = { image: await canvasShot(page), metrics: await measure(page) };
      await load(page, shipped);
      const after = { image: await canvasShot(page), metrics: await measure(page) };
      await compose(page, name, tag, before, after, "Before = the same circuit as main ships it today (default L routes). After = the routes PR #26 stores in the example.");
    }
  });

  test(`a student's circuit (example F plus an added LED) before/after at ${tag}`, async ({ page }) => {
    await open(page, size);
    await page.selectOption("#exampleSelect", "external-led-button");
    await expect(page.locator(".wire")).toHaveCount(5);
    await page.getByRole("button", { name: /Part/ }).click();
    await page.locator('.library-item[data-type="led"]').click();
    await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
    await page.locator("#circuitCanvas").press("Escape");
    await connect(page, "board1:J2.3", "led2:A");
    await connect(page, "led2:C", "board1:J2.1");
    await page.evaluate(() => window.__tm4c.workspace.fit());
    await page.mouse.move(2, 2);
    const final = await serialize(page);
    const after = { image: await canvasShot(page), metrics: await measure(page) };
    await load(page, withRouting(final, "legacy"));
    const before = { image: await canvasShot(page), metrics: await measure(page) };
    await compose(page, "Student circuit", tag, before, after, "Example F with an LED added from the library and wired J2.3 → anode, cathode → J2.1 (GND) through the UI. Before = all seven wires with default L routes.");
  });

  test(`crowded stress circuit before/after at ${tag}`, async ({ page }) => {
    await open(page, size);
    const { parts, wires } = crowded();
    const text = JSON.stringify({ version: 1, author: "", editor: "evidence", parts, connections: [] });
    await load(page, text);
    for (const [from, to] of wires) {
      await connect(page, from, to);
    }
    await page.evaluate(() => window.__tm4c.workspace.fit());
    await page.mouse.move(2, 2);
    const final = await serialize(page);
    const after = { image: await canvasShot(page), metrics: await measure(page) };
    await load(page, withRouting(final, "legacy"));
    const before = { image: await canvasShot(page), metrics: await measure(page) };
    await compose(page, "Crowded stress circuit", tag, before, after, "30 wires from all four headers to 14 LEDs and 2 resistors placed on both sides, drawn through the UI. A stress test, not a typical lab circuit.");
  });
}

test("board detail (zoomed) before/after for the LCD example and the crowded circuit at 1920x1080", async ({ page }) => {
  await open(page, { width: 1920, height: 1080 });
  await page.selectOption("#exampleSelect", "lcd1602-hello");
  await expect(page.locator(".wire").first()).toBeVisible();
  const shipped = await serialize(page);
  const detail = async (text) => {
    await load(page, text);
    await page.evaluate(() => { window.__tm4c.workspace.zoom(1.6); });
    await page.mouse.move(2, 2);
    return { image: await canvasShot(page), metrics: await measure(page) };
  };
  await compose(page, "LCD example board detail", "1920x1080-zoomed", await detail(withRouting(shipped, "legacy")), await detail(shipped), "Zoomed to the board: header rows, SW1, SW2, RESET.");
});
