/*
 * Wire-routing design audit (verification branch only, not for merge; no
 * product code changes). Loads controlled circuits into the real app and, for
 * every auto-routed wire, measures which unrelated pin pads its route passes
 * over, using the app's own routeWire() and pin positions. Candidate routing
 * rules are evaluated side by side (pure functions here, never wired into the
 * product): crossings, bends, length, cost per route, how often the choice
 * flips while a preview or a dragged part moves, and how many existing
 * auto-routed wires would change shape. Overlay screenshots show each rule.
 */
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const G = 9.6;
const board = { type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0, rotate: 0, attrs: {} };
const led = (id, left, top) => ({ type: "led", id, top, left, rotate: 0, attrs: { color: "red" } });
const res = (id, left, top) => ({ type: "resistor", id, top, left, rotate: 0, attrs: { value: "220" } });
const wire = (a, b, routing = []) => [a, b, "green", routing];
const diagram = (parts, connections) => JSON.stringify({ version: 1, author: "", editor: "audit", parts: [board, ...parts], connections });

/** Controlled circuits (world units; 1 grid = 0.1 in = 9.6). */
function scenarios() {
  const left = Array.from({ length: 5 }, (_, i) => led(`ledL${i + 1}`, -14 * G, (10 + 7 * i) * G));
  const right = Array.from({ length: 5 }, (_, i) => led(`ledR${i + 1}`, 25 * G, (10 + 7 * i) * G));
  const far = Array.from({ length: 4 }, (_, i) => led(`ledF${i + 1}`, 34 * G, (12 + 8 * i) * G));
  return {
    "simple-led": diagram([led("led1", 22 * G, 1 * G)], [wire("board1:J1.10", "led1:A")]),
    "left-headers-to-left-parts": diagram(left, left.flatMap((p, i) => [wire(`board1:J1.${i + 1}`, `${p.id}:A`), wire(`board1:J3.${i + 1}`, `${p.id}:C`)])),
    "left-headers-to-right-parts": diagram(right, right.flatMap((p, i) => [wire(`board1:J3.${i + 1}`, `${p.id}:A`), wire(`board1:J1.${i + 6}`, `${p.id}:C`)])),
    "right-headers-to-right-parts": diagram(far, far.flatMap((p, i) => [wire(`board1:J4.${i + 2}`, `${p.id}:A`), wire(`board1:J2.${i + 2}`, `${p.id}:C`)])),
    crowded: diagram([...left, ...right, ...far, res("r1", -14 * G, -4 * G), res("r2", 25 * G, -4 * G)], [
      ...left.flatMap((p, i) => [wire(`board1:J1.${i + 1}`, `${p.id}:A`), wire(`board1:J3.${i + 1}`, `${p.id}:C`)]),
      ...right.flatMap((p, i) => [wire(`board1:J3.${i + 6}`, `${p.id}:A`), wire(`board1:J1.${i + 6}`, `${p.id}:C`)]),
      ...far.flatMap((p, i) => [wire(`board1:J4.${i + 2}`, `${p.id}:A`), wire(`board1:J2.${i + 2}`, `${p.id}:C`)]),
      wire("board1:J4.1", "r2:1"), wire("board1:J2.1", "r1:2"),
    ]),
    // A wire the student rerouted by hand (explicit routing): must never change under any rule.
    "manual-reroute": diagram([led("led1", 22 * G, 1 * G)], [wire("board1:J1.10", "led1:A", ["h-19.2", "v-96"])]),
  };
}

/** The in-page analyser: candidate rules, metrics, and overlays. Installed once per page. */
async function installAnalyser(page) {
  await page.evaluate(async (grid) => {
    const geometry = await import("/workspace/geometry.js");
    const { routeWire, simplify, pathData } = geometry;
    const ws = window.__tm4c.workspace;
    const ESCAPE = { J1: -1, J3: 1, J4: -1, J2: 1 }; // away from the paired header column
    const R = 0.45 * grid; // a route within this distance of a pad centre is drawn over the pad

    const pins = () => [...document.querySelectorAll(".pin-anchor")].map((n) => {
      const id = `${n.dataset.part}:${n.dataset.pin}`;
      return { id, ...ws.pinPosition(id) };
    });
    const segDist = (p, a, b) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    const contacts = (points, allPins, exclude) => allPins.filter((p) => !exclude.has(p.id) && points.some((q, i) => i > 0 && segDist(p, points[i - 1], q) < R)).map((p) => p.id);
    const length = (points) => points.reduce((sum, q, i) => (i ? sum + Math.abs(q.x - points[i - 1].x) + Math.abs(q.y - points[i - 1].y) : 0), 0);
    const header = (id) => (id?.startsWith("board1:J") ? id.split(":")[1].split(".")[0] : null);

    const candidates = (from, to, a, b, withStubs) => {
      const list = [
        { kind: "L-h", points: simplify([a, { x: b.x, y: a.y }, b]) },
        { kind: "L-v", points: simplify([a, { x: a.x, y: b.y }, b]) },
      ];
      if (withStubs) {
        const hs = header(from);
        if (hs) {
          const x = a.x + ESCAPE[hs] * grid;
          list.push({ kind: "Z-source", points: simplify([a, { x, y: a.y }, { x, y: b.y }, b]) });
        }
        const ht = header(to);
        if (ht) {
          const x = b.x + ESCAPE[ht] * grid;
          list.push({ kind: "Z-target", points: simplify([a, { x, y: a.y }, { x, y: b.y }, b]) });
        }
      }
      return list;
    };
    const choose = (list, allPins, exclude) => list
      .map((c, index) => ({ ...c, index, hits: contacts(c.points, allPins, exclude) }))
      .sort((p, q) => p.hits.length - q.hits.length || (p.points.length - q.points.length) || (length(p.points) - length(q.points)) || p.index - q.index)[0];

    const RULES = {
      current: (from, to, a, b, routing) => ({ kind: "current", points: routeWire(a, b, routing) }),
      bestL: (from, to, a, b, routing, allPins, exclude) => (routing.length ? { kind: "explicit", points: routeWire(a, b, routing) } : choose(candidates(from, to, a, b, false), allPins, exclude)),
      escape: (from, to, a, b, routing, allPins, exclude) => (routing.length ? { kind: "explicit", points: routeWire(a, b, routing) } : choose(candidates(from, to, a, b, true), allPins, exclude)),
    };

    window.__routingAudit = {
      RULES,
      pins,
      contacts,
      R,
      routeAll(rule) {
        const allPins = pins();
        return window.__tm4c.diagram.connections.map(([from, to, , routing = []], index) => {
          const a = ws.pinPosition(from);
          const b = ws.pinPosition(to);
          const exclude = new Set([from, to]);
          const route = RULES[rule](from, to, a, b, routing, allPins, exclude);
          return { index, from, to, auto: routing.length === 0, kind: route.kind, points: route.points, hits: contacts(route.points, allPins, exclude) };
        });
      },
      summary(rule) {
        const routes = this.routeAll(rule);
        const current = this.routeAll("current");
        return {
          wires: routes.length,
          padsCrossed: routes.reduce((s, r) => s + r.hits.length, 0),
          wiresCrossingPads: routes.filter((r) => r.hits.length).length,
          bends: routes.reduce((s, r) => s + r.points.length - 2, 0),
          length: Math.round(routes.reduce((s, r) => s + length(r.points), 0)),
          autoWiresChangedVsCurrent: routes.filter((r, i) => r.auto && JSON.stringify(r.points) !== JSON.stringify(current[i].points)).length,
          manualWiresChanged: routes.filter((r, i) => !r.auto && JSON.stringify(r.points) !== JSON.stringify(current[i].points)).length,
          kinds: routes.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {}),
          examples: routes.filter((r) => r.hits.length).slice(0, 4).map((r) => `${r.from}→${r.to}: ${r.hits.join(" ")}`),
        };
      },
      /** Replaces the drawn wires with a rule's routes and rings the pads they cross (audit overlay only). */
      overlay(rule) {
        ws.render();
        document.querySelector(".audit-overlay")?.remove();
        const svg = document.querySelector("#circuitCanvas");
        const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
        layer.setAttribute("class", "audit-overlay");
        layer.setAttribute("pointer-events", "none");
        svg.append(layer);
        const allPins = pins();
        for (const route of this.routeAll(rule)) {
          for (const path of document.querySelectorAll(`.wire[data-wire="${route.index}"] path`)) {
            path.setAttribute("d", pathData(route.points));
          }
          for (const id of route.hits) {
            const p = allPins.find((q) => q.id === id);
            const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            Object.entries({ cx: p.x, cy: p.y, r: 0.75 * grid, fill: "none", stroke: "#ff3b30", "stroke-width": 1.4 }).forEach(([k, v]) => ring.setAttribute(k, v));
            layer.append(ring);
          }
        }
      },
      restore() {
        document.querySelector(".audit-overlay")?.remove();
        ws.render();
      },
      /** Cost per route in microseconds (all wires of the circuit, repeated). */
      timing(rule, rounds = 300) {
        const allPins = pins();
        const wires = window.__tm4c.diagram.connections.map(([from, to, , routing = []]) => ({ from, to, routing, a: ws.pinPosition(from), b: ws.pinPosition(to) }));
        const t0 = performance.now();
        for (let i = 0; i < rounds; i++) {
          for (const w of wires) {
            RULES[rule](w.from, w.to, w.a, w.b, w.routing, allPins, new Set([w.from, w.to]));
          }
        }
        return +(((performance.now() - t0) * 1000) / (rounds * wires.length)).toFixed(2);
      },
      /** How often the chosen shape changes while a preview end (or a dragged part pin) moves along a path. */
      flips(rule, from, path, exclude = []) {
        const allPins = pins();
        const a = ws.pinPosition(from);
        let last = null;
        let changes = 0;
        let crossings = 0;
        for (const b of path) {
          const route = RULES[rule](from, null, a, b, [], allPins, new Set([from, ...exclude]));
          crossings += contacts(route.points, allPins, new Set([from, ...exclude])).length;
          if (last !== null && route.kind !== last) {
            changes++;
          }
          last = route.kind;
        }
        return { samples: path.length, shapeChanges: changes, meanPadsCrossed: +(crossings / path.length).toFixed(2) };
      },
    };
  }, G);
}

const RULE_NAMES = ["current", "bestL", "escape"];

test("route-coordinate analysis: controlled circuits, examples, manual routes, cost, and stability", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept()); // replacing our own audit circuits with an example
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await installAnalyser(page);
  const report = { contactRadiusWorld: 0.45 * G, scenarios: {} };

  const analyse = async (name) => {
    await page.evaluate(() => window.__tm4c.workspace.fit());
    const entry = {};
    for (const rule of RULE_NAMES) {
      entry[rule] = await page.evaluate((r) => ({ ...window.__routingAudit.summary(r), usPerRoute: window.__routingAudit.timing(r) }), rule);
    }
    report.scenarios[name] = entry;
    if (["simple-led", "left-headers-to-right-parts", "crowded", "lcd1602-hello"].includes(name)) {
      for (const rule of RULE_NAMES) {
        await page.evaluate((r) => window.__routingAudit.overlay(r), rule);
        await page.screenshot({ path: `test-results/routing-${name}-${rule}-1280x720.png` });
      }
      await page.evaluate(() => window.__routingAudit.restore());
    }
  };

  for (const [name, text] of Object.entries(scenarios())) {
    expect(await page.evaluate((t) => window.__tm4c.load(t), text), name).toBe(true);
    await analyse(name);
  }
  for (const example of ["lcd1602-hello", "external-led-button", "adc-potentiometer"]) {
    await page.evaluate(() => window.__tm4c.load(JSON.stringify({ version: 1, parts: [{ type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0 }], connections: [] })));
    await page.selectOption("#exampleSelect", example);
    await expect(page.locator(".wire").first()).toBeVisible();
    await analyse(example);
  }

  // Stability: the wire preview from J1.10 while the pointer circles the board, and a part dragged past it.
  await page.evaluate((t) => window.__tm4c.load(t), scenarios()["simple-led"]);
  report.stability = await page.evaluate((grid) => {
    const snap = (v) => Math.round(v / grid) * grid;
    const ring = Array.from({ length: 360 }, (_, i) => {
      const t = (i / 360) * 2 * Math.PI;
      return { x: snap(96 + 170 * Math.cos(t)), y: snap(125 + 190 * Math.sin(t)) };
    });
    const pinA = window.__tm4c.workspace.pinPosition("led1:A");
    const drag = Array.from({ length: 200 }, (_, i) => ({ x: snap(pinA.x - i * 2.4), y: snap(pinA.y + 60 * Math.sin(i / 15)) }));
    const out = {};
    for (const rule of ["current", "bestL", "escape"]) {
      out[rule] = {
        previewAroundBoard: window.__routingAudit.flips(rule, "board1:J1.10", ring),
        dragLedAcrossBoard: window.__routingAudit.flips(rule, "board1:J1.10", drag, ["led1:A"]),
      };
    }
    return out;
  }, G);
  await writeFile("test-results/audit-routing.json", JSON.stringify(report, null, 2));
  expect(errors).toEqual([]);
});

test("routing overlays at 1920x1080: LCD example and the crowded circuit", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await installAnalyser(page);
  await page.selectOption("#exampleSelect", "lcd1602-hello");
  await expect(page.locator(".wire").first()).toBeVisible();
  for (const rule of ["current", "escape"]) {
    await page.evaluate((r) => window.__routingAudit.overlay(r), rule);
    await page.screenshot({ path: `test-results/routing-lcd1602-hello-${rule}-1920x1080.png` });
  }
  await page.evaluate(() => window.__routingAudit.restore());
  await page.evaluate((t) => window.__tm4c.load(t), scenarios().crowded);
  for (const rule of ["current", "escape"]) {
    await page.evaluate((r) => window.__routingAudit.overlay(r), rule);
    await page.screenshot({ path: `test-results/routing-crowded-${rule}-1920x1080.png` });
  }
  expect(errors).toEqual([]);
});
