/*
 * Interaction evidence for the redesigned interface (not part of the test
 * suite): one continuous take of the real app at 1280x720 with real pointer
 * input, recorded by Chromium, run by .github/workflows/interaction-video.yml.
 *
 * It builds a circuit by hand (library, dragging two parts, three wires),
 * zooms, pans, fits, and runs the shipped firmware (example A, PF1 HIGH) on
 * Renode, which lights the on-board red LED and the LED wired to PF1. Each
 * step asserts what it shows, so the take only completes if the app did it.
 *
 * Pointer moves are paced like a hand (one move per 16 ms), and the page
 * records every animation frame, so each phase reports its frame intervals
 * (smoothness while that interaction ran). The only addition to the page is a
 * drawn pointer (headless frames have no cursor), which ignores events.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const OUT = "interaction-output";
const SIZE = { width: 1280, height: 720 };

/** A drawn pointer that follows real pointer events, with a ring on each press. */
function pointerOverlay() {
  const install = () => {
    const style = document.createElement("style");
    style.textContent = `
      #rec-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform: translate(-60px, -60px); }
      .rec-press { position: fixed; z-index: 2147483646; pointer-events: none; width: 28px; height: 28px; margin: -14px 0 0 -14px;
        border: 2px solid #58a6ff; border-radius: 50%; animation: rec-press 0.5s ease-out forwards; }
      @keyframes rec-press { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`;
    document.head.append(style);
    const pointer = document.createElement("div");
    pointer.id = "rec-pointer";
    pointer.setAttribute("aria-hidden", "true");
    pointer.innerHTML = '<svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 2 L2 19 L6.4 14.9 L9.4 21.6 L12.3 20.3 L9.3 13.7 L15.2 13.7 Z" fill="#ffffff" stroke="#0d1117" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.append(pointer);
    window.addEventListener("pointermove", (event) => {
      pointer.style.transform = `translate(${event.clientX - 2}px, ${event.clientY - 2}px)`;
    }, true);
    window.addEventListener("pointerdown", (event) => {
      const ring = document.createElement("div");
      ring.className = "rec-press";
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      document.body.append(ring);
      setTimeout(() => ring.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
}

/** Every animation frame's time, long tasks, and slow input events, from page load. */
function frameRecorder() {
  const frames = [];
  const longTasks = [];
  const slowEvents = [];
  const tick = (t) => {
    frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        slowEvents.push({ name: entry.name, start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {
    // Observers are diagnostics only.
  }
  window.__rec = { frames, longTasks, slowEvents };
}

/** Moves the pointer to `to` over `ms`, one move per 16 ms (a hand's pace), from `from`. */
async function glide(page, from, to, ms = 600) {
  const steps = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await page.waitForTimeout(16);
  }
  return to;
}

const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const pin = async (page, part, name) => center(await page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`).boundingBox());
const viewBox = async (page) => (await page.locator("#circuitCanvas").getAttribute("viewBox")).split(/\s+/).map(Number);

/** A point on empty canvas (no part, wire, pin or hint under it), as far from the circuit as possible. */
async function emptySpot(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#circuitCanvas").getBoundingClientRect();
    const items = [...document.querySelectorAll("#circuitCanvas .part, #circuitCanvas .wire")].map((n) => n.getBoundingClientRect());
    let best = null;
    for (let fx = 0.08; fx < 0.95; fx += 0.06) {
      for (let fy = 0.1; fy < 0.9; fy += 0.06) {
        const x = canvas.x + canvas.width * fx;
        const y = canvas.y + canvas.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest("#circuitCanvas") || hit.closest(".part, .wire, .pin-anchor")) {
          continue;
        }
        const room = Math.min(...items.map((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))));
        if (!best || room > best.room) {
          best = { x, y, room };
        }
      }
    }
    return best;
  });
}

test("new interface, one take: add, drag, wire, zoom, pan, fit, run", async ({ browser }) => {
  await mkdir(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: `${OUT}/raw`, size: SIZE } });
  const page = await context.newPage();
  const videoStart = Date.now();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.addInitScript(pointerOverlay);
  await page.addInitScript(frameRecorder);

  const phases = [];
  const phase = async (name) => {
    const t = await page.evaluate(() => performance.now());
    phases.push({ name, t, video: (Date.now() - videoStart) / 1000 });
  };
  let at = { x: 640, y: 400 };

  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator("#exampleSelect")).toHaveValue("gpiof-red-led");
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  // The redesigned shell as merged: the inspector starts collapsed.
  await expect(page.locator(".simulator-panel")).toHaveAttribute("data-inspector", "closed");
  await page.mouse.move(at.x, at.y);
  await phase("open");
  await page.waitForTimeout(1500);

  // Library: add an LED and a resistor (each lands beside the board, selected).
  await phase("library");
  for (const type of ["led", "resistor"]) {
    const button = center(await page.locator("#addPartButton").boundingBox());
    at = await glide(page, at, button, 500);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator("#partLibrary")).toBeVisible();
    await page.waitForTimeout(400);
    const item = center(await page.locator(`#partLibrary .library-item[data-type="${type}"]`).boundingBox());
    at = await glide(page, at, item, 450);
    await page.waitForTimeout(250);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator("#partLibrary")).toBeHidden();
    await page.waitForTimeout(600);
  }
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await expect(page.locator('.part[data-part="r1"]')).toHaveCount(1);

  // Drag both parts into place right of the board: the resistor low, the LED beyond it.
  await phase("drag");
  const place = async (part, fx, fy) => {
    const board = await page.locator('.part[data-part="board1"] .part-hitbox').boundingBox();
    const canvas = await page.locator("#circuitCanvas").boundingBox();
    const box = await page.locator(`.part[data-part="${part}"] .part-hitbox`).boundingBox();
    const grab = { x: box.x + box.width / 2, y: box.y + box.height / 4 };
    const right = board.x + board.width;
    const target = { x: right + (canvas.x + canvas.width - right) * fx, y: board.y + board.height * fy };
    at = await glide(page, at, grab, 500);
    const before = await page.locator(`.part[data-part="${part}"]`).getAttribute("transform");
    await page.mouse.down();
    at = await glide(page, at, target, 900);
    await page.mouse.up();
    expect(await page.locator(`.part[data-part="${part}"]`).getAttribute("transform")).not.toBe(before);
    await page.waitForTimeout(400);
  };
  await place("r1", 0.35, 0.84);
  await place("led1", 0.68, 0.5);

  // Wires: PF1 (J3.10) -> resistor (drag-to-connect), resistor -> LED anode (click, then click),
  // LED cathode -> GND (J2.1, drag-to-connect). Each is confirmed by the app.
  await phase("wire");
  const rPins = await Promise.all(["1", "2"].map(async (name) => ({ name, at: await pin(page, "r1", name) })));
  rPins.sort((a, b) => a.at.x - b.at.x);
  const [near, far] = rPins.map((p) => p.name);
  const dragWire = async (fromPart, fromPin, toPart, toPin) => {
    at = await glide(page, at, await pin(page, fromPart, fromPin), 500);
    await page.mouse.down();
    at = await glide(page, at, await pin(page, toPart, toPin), 900);
    await page.mouse.up();
    await expect(page.locator("#workspaceMessage")).toHaveText(`Connected ${fromPart}:${fromPin} → ${toPart}:${toPin}.`);
    await page.waitForTimeout(500);
  };
  await dragWire("board1", "J3.10", "r1", near);
  at = await glide(page, at, await pin(page, "r1", far), 500);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#circuitCanvas")).toHaveClass(/is-wiring/);
  at = await glide(page, at, await pin(page, "led1", "A"), 700);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#workspaceMessage")).toHaveText(`Connected r1:${far} → led1:A.`);
  await page.waitForTimeout(500);
  await dragWire("led1", "C", "board1", "J2.1");
  await expect(page.locator(".wire")).toHaveCount(3);
  await page.locator("#circuitCanvas").press("Escape");

  // Zoom: the wheel over the resistor (anchored at the pointer), then a step back out with the button.
  await phase("zoom");
  const before = await viewBox(page);
  at = await glide(page, at, center(await page.locator('.part[data-part="r1"] .part-hitbox').boundingBox()), 500);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(140);
  }
  const zoomed = await viewBox(page);
  expect(zoomed[2]).toBeLessThan(before[2]);
  await page.waitForTimeout(500);
  at = await glide(page, at, center(await page.locator("#zoomOutButton").boundingBox()), 600);
  await page.mouse.click(at.x, at.y);
  expect((await viewBox(page))[2]).toBeGreaterThan(zoomed[2]);
  await page.waitForTimeout(500);

  // Pan: drag empty canvas; the view moves, the scale stays.
  await phase("pan");
  const spot = await emptySpot(page);
  expect(spot, "an empty spot on the canvas to pan from").not.toBeNull();
  const unpanned = await viewBox(page);
  at = await glide(page, at, spot, 500);
  await page.mouse.down();
  const canvasBox = await page.locator("#circuitCanvas").boundingBox();
  const dx = spot.x < canvasBox.x + canvasBox.width / 2 ? 160 : -160;
  at = await glide(page, at, { x: spot.x + dx, y: spot.y + 70 }, 900);
  await page.mouse.up();
  const panned = await viewBox(page);
  expect(panned[0]).not.toBeCloseTo(unpanned[0], 3);
  expect(panned[2]).toBeCloseTo(unpanned[2], 5);
  await page.waitForTimeout(500);
  // Fit brings the whole circuit back into view.
  at = await glide(page, at, center(await page.locator("#fitButton").boundingBox()), 600);
  await page.mouse.click(at.x, at.y);
  expect(await viewBox(page)).not.toEqual(panned);
  await page.waitForTimeout(800);

  // Run: real GCC build, then Renode; PF1 goes HIGH and both LEDs light.
  await phase("run");
  at = await glide(page, at, center(await page.locator("#runButton").boundingBox()), 700);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 90_000 });
  await expect(page.locator("#redLed")).toHaveClass(/active/, { timeout: 60_000 });
  await expect(page.locator('.part[data-part="led1"] .part-led')).toHaveClass(/lit/, { timeout: 30_000 });
  await phase("running");
  const virtualTime = () => page.locator("#virtualTime").textContent();
  const startedAt = await virtualTime();
  at = await glide(page, at, await pin(page, "board1", "J3.10"), 800);
  await expect(page.locator("#pinTooltip")).toContainText("PF1");
  await page.waitForTimeout(2500);
  await expect.poll(virtualTime, { timeout: 30_000 }).not.toBe(startedAt);
  at = await glide(page, at, center(await page.locator("#stopButton").boundingBox()), 700);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#simulationStatus")).toHaveText("Stopped", { timeout: 30_000 });
  await phase("end");
  await page.waitForTimeout(1200);

  const rec = await page.evaluate(() => window.__rec);
  const end = await page.evaluate(() => performance.now());
  expect(errors).toEqual([]);
  await context.close();
  await page.video().saveAs(`${OUT}/new-ui-interaction.webm`);

  // Frame intervals per phase (only the interactive phases: "running" includes compile/start waits).
  const stats = phases.slice(0, -1).map((p, i) => {
    const until = phases[i + 1]?.t ?? end;
    const times = rec.frames.filter((t) => t >= p.t && t < until);
    const gaps = times.slice(1).map((t, k) => t - times[k]).sort((a, b) => a - b);
    const q = (f) => (gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))] * 10) / 10 : null);
    return {
      phase: p.name,
      seconds: Math.round((until - p.t) / 100) / 10,
      videoAt: Math.round(p.video * 10) / 10,
      frames: times.length,
      fps: gaps.length ? Math.round((gaps.length / ((times.at(-1) - times[0]) / 1000)) * 10) / 10 : null,
      medianMs: q(0.5),
      p95Ms: q(0.95),
      maxMs: gaps.length ? Math.round(gaps.at(-1) * 10) / 10 : null,
      over50ms: gaps.filter((g) => g > 50).length,
      longTasks: rec.longTasks.filter((l) => l.start >= p.t && l.start < until).map((l) => Math.round(l.duration)),
      slowEvents: rec.slowEvents.filter((e) => e.start >= p.t && e.start < until).map((e) => `${e.name} ${Math.round(e.duration)}ms`),
    };
  });
  await writeFile(`${OUT}/timeline.json`, JSON.stringify({ size: SIZE, phases: phases.map(({ name, video }) => ({ name, video })), stats }, null, 2));
  console.log(JSON.stringify(stats, null, 2));
});
