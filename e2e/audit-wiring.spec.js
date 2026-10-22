/*
 * Wiring and workspace UX audit (verification branch only, not for merge).
 * Drives the real canvas with real pointer input (Playwright mouse) and
 * records evidence as JSON in test-results/audit-*.json plus screenshots:
 * preview accuracy against the pointer, handler cost per pointermove, how
 * many DOM rebuilds each move causes, preview-vs-committed routing, gestures
 * that cancel or ignore a wire in progress, hover feedback, hit-target sizes,
 * and responsiveness in a dense circuit. Findings are recorded, not asserted.
 */
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const GRID = 9.6;

async function open(page, size, example = null) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  if (example) {
    await page.selectOption("#exampleSelect", example);
  }
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  await instrument(page);
  return errors;
}

/** Page-side probes: per-pointermove handler time, draft-vs-pointer deviation, DOM rebuild counters, tooltip toggles. */
async function instrument(page) {
  await page.evaluate((grid) => {
    const svg = document.querySelector("#circuitCanvas");
    const audit = { moves: [], wireRebuilds: 0, overlayRebuilds: 0, tooltipChanges: 0, tooltipToggles: 0 };
    window.__audit = audit;
    let t0 = 0;
    window.addEventListener("pointermove", () => { t0 = performance.now(); }, { capture: true });
    document.addEventListener("pointermove", (event) => {
      const ms = performance.now() - t0;
      const draft = document.querySelector(".wire-draft");
      let deviation = null;
      let lagPx = null;
      if (draft) {
        const points = [...draft.getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
        const end = points.at(-1);
        const ctm = svg.getScreenCTM();
        const p = svg.createSVGPoint();
        p.x = event.clientX;
        p.y = event.clientY;
        const world = p.matrixTransform(ctm.inverse());
        const pin = event.target.closest?.(".pin-anchor");
        const expected = pin
          ? window.__tm4c.workspace.pinPosition(`${pin.dataset.part}:${pin.dataset.pin}`)
          : { x: Math.round(world.x / grid) * grid, y: Math.round(world.y / grid) * grid };
        deviation = Math.hypot(end.x - expected.x, end.y - expected.y);
        lagPx = Math.hypot(end.x - world.x, end.y - world.y) * ctm.a; // preview end vs cursor, screen px
      }
      audit.moves.push({ ms, deviation, lagPx });
    });
    new MutationObserver(() => { audit.wireRebuilds++; }).observe(svg.querySelector(".layer-wires"), { childList: true });
    new MutationObserver(() => { audit.overlayRebuilds++; }).observe(svg.querySelector(".layer-overlay"), { childList: true });
    const tooltip = document.querySelector("#pinTooltip");
    let hidden = tooltip.hidden;
    new MutationObserver(() => {
      audit.tooltipChanges++;
      if (tooltip.hidden !== hidden) {
        hidden = tooltip.hidden;
        audit.tooltipToggles++;
      }
    }).observe(tooltip, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  }, GRID);
}

async function takeAudit(page, reset = true) {
  return page.evaluate((clear) => {
    const audit = window.__audit;
    const moves = audit.moves;
    const ms = moves.map((m) => m.ms).sort((a, b) => a - b);
    const dev = moves.map((m) => m.deviation).filter((d) => d !== null);
    const lag = moves.map((m) => m.lagPx).filter((d) => d !== null);
    const summary = {
      moves: moves.length,
      handlerMs: ms.length ? { mean: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(3), max: +ms.at(-1).toFixed(3) } : null,
      previewDeviationWorld: dev.length ? { max: +Math.max(...dev).toFixed(3), nonZero: dev.filter((d) => d > 1e-6).length } : null,
      previewLagPx: lag.length ? { max: +Math.max(...lag).toFixed(2), mean: +(lag.reduce((a, b) => a + b, 0) / lag.length).toFixed(2) } : null,
      wireRebuilds: audit.wireRebuilds,
      overlayRebuilds: audit.overlayRebuilds,
      tooltipChanges: audit.tooltipChanges,
      tooltipToggles: audit.tooltipToggles,
    };
    if (clear) {
      Object.assign(audit, { moves: [], wireRebuilds: 0, overlayRebuilds: 0, tooltipChanges: 0, tooltipToggles: 0 });
    }
    return summary;
  }, reset);
}

const anchor = (page, part, pin) => page.locator(`.pin-anchor[data-part="${part}"][data-pin="${pin}"]`);
async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function addLed(page) {
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Escape");
}
const save = (name, data) => writeFile(`test-results/audit-${name}.json`, JSON.stringify(data, null, 2));

for (const size of SIZES) {
  test(`click-click wiring: preview accuracy, cost, and preview = committed at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    await addLed(page);
    const results = [];
    for (const zoom of [{ name: "fit", clicks: 0 }, { name: "zoomed-in", clicks: 2 }, { name: "zoomed-out", clicks: -2 }]) {
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      for (let i = 0; i < Math.abs(zoom.clicks); i++) {
        await page.getByRole("button", { name: zoom.clicks > 0 ? "Zoom in" : "Zoom out", exact: true }).click();
      }
      for (const steps of [1, 8, 40]) {
        const a = await centerOf(anchor(page, "board1", "J1.10"));
        const b = await centerOf(anchor(page, "led1", "A"));
        const view = await page.locator("#circuitCanvas").boundingBox();
        const inView = (p) => p.x > view.x + 4 && p.y > view.y + 4 && p.x < view.x + view.width - 4 && p.y < view.y + view.height - 4;
        if (!inView(a) || !inView(b)) {
          results.push({ zoom: zoom.name, steps, skipped: "a pin is outside the visible canvas at this zoom" });
          continue;
        }
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.up(); // click: the draft starts
        await takeAudit(page);
        // Wander past the target first (off-pin), then onto it.
        await page.mouse.move((a.x + b.x) / 2 + 37.3, (a.y + b.y) / 2 - 23.7, { steps });
        await page.mouse.move(b.x, b.y, { steps });
        const draftD = await page.locator(".wire-draft").getAttribute("d");
        const draftInvalid = await page.locator(".wire-draft.invalid").count();
        const probe = await takeAudit(page);
        if (zoom.name === "fit" && steps === 8) {
          await page.screenshot({ path: `test-results/audit-draft-${size.width}x${size.height}.png` });
        }
        await page.mouse.down();
        await page.mouse.up(); // click on the target: the wire is created
        const committed = await page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"] .wire-core').getAttribute("d");
        const normalize = (d) => d?.replace(/\s+/g, " ").trim();
        results.push({
          zoom: zoom.name,
          zoomLevel: await page.evaluate(() => window.__tm4c.workspace.zoomLevel),
          steps,
          ...probe,
          draftInvalidOverTarget: draftInvalid > 0,
          previewEqualsCommitted: normalize(draftD) === normalize(committed),
          draftD,
          committed,
        });
        await page.locator("#circuitCanvas").press("Control+z");
        await expect(page.locator(".wire")).toHaveCount(0);
      }
    }
    // Hit targets: pin anchor radius and header pitch on screen at each zoom.
    const targets = [];
    for (const zoom of [0, 3, -3]) {
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      for (let i = 0; i < Math.abs(zoom); i++) {
        await page.getByRole("button", { name: zoom > 0 ? "Zoom in" : "Zoom out", exact: true }).click();
      }
      targets.push(await page.evaluate(() => {
        const svg = document.querySelector("#circuitCanvas");
        const scale = svg.getScreenCTM().a;
        const a = document.querySelector('.pin-anchor[data-part="board1"][data-pin="J1.1"]');
        const b = document.querySelector('.pin-anchor[data-part="board1"][data-pin="J1.2"]');
        return {
          zoom: +window.__tm4c.workspace.zoomLevel.toFixed(3),
          hitDiameterPx: +(2 * Number(a.getAttribute("r")) * scale).toFixed(2),
          pitchPx: +(Math.hypot(b.getAttribute("cx") - a.getAttribute("cx"), b.getAttribute("cy") - a.getAttribute("cy")) * scale).toFixed(2),
        };
      }));
    }
    await save(`click-click-${size.width}x${size.height}`, { results, targets });
    expect(errors).toEqual([]);
  });
}

test("drag-to-connect, panning and zooming while a wire is in progress", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await addLed(page);
  const findings = {};
  const message = () => page.locator("#workspaceMessage").textContent();
  const draftVisible = async () => (await page.locator(".wire-draft").count()) > 0;
  const a = await centerOf(anchor(page, "board1", "J1.10"));
  const b = await centerOf(anchor(page, "led1", "A"));

  // 1. Press on a pin, drag to another pin, release (the most common first attempt).
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  findings.dragRelease = { wires: await page.locator(".wire").count(), draftStillActive: await draftVisible(), message: await message() };
  await page.screenshot({ path: "test-results/audit-drag-release-1280x720.png" });
  // A second click on the target then completes it?
  await page.mouse.down();
  await page.mouse.up();
  findings.dragReleaseThenClick = { wires: await page.locator(".wire").count(), message: await message() };
  await page.locator("#circuitCanvas").press("Control+z");

  // 2. Start a wire, then left-drag on empty canvas to pan towards a far pin.
  const canvas = await page.locator("#circuitCanvas").boundingBox();
  const empty = { x: canvas.x + 30, y: canvas.y + canvas.height - 30 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  const viewBefore = await page.evaluate(() => ({ ...window.__tm4c.workspace.viewBox }));
  await page.mouse.move(empty.x, empty.y, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(empty.x + 80, empty.y - 40, { steps: 8 });
  await page.mouse.up();
  findings.leftDragPanWhileWiring = {
    draftStillActive: await draftVisible(),
    viewPanned: JSON.stringify(viewBefore) !== JSON.stringify(await page.evaluate(() => ({ ...window.__tm4c.workspace.viewBox }))),
    message: await message(),
  };

  // 3. Middle-button pan while wiring.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(empty.x, empty.y, { steps: 5 });
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(empty.x + 80, empty.y - 40, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  findings.middlePanWhileWiring = { draftStillActive: await draftVisible(), message: await message() };
  await page.locator("#circuitCanvas").press("Escape");

  // 4. Wheel zoom while wiring: does the preview follow without moving the mouse?
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  const mid = { x: canvas.x + canvas.width * 0.7, y: canvas.y + canvas.height * 0.5 };
  await page.mouse.move(mid.x, mid.y, { steps: 6 });
  const before = await page.locator(".wire-draft").getAttribute("d");
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(150);
  const afterWheel = await page.evaluate(({ x, y }) => {
    const svg = document.querySelector("#circuitCanvas");
    const p = svg.createSVGPoint();
    p.x = x;
    p.y = y;
    const world = p.matrixTransform(svg.getScreenCTM().inverse());
    const d = document.querySelector(".wire-draft")?.getAttribute("d") ?? "";
    const end = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })).at(-1);
    return { draftStillActive: Boolean(d), endToCursorPx: end ? +(Math.hypot(end.x - world.x, end.y - world.y) * svg.getScreenCTM().a).toFixed(1) : null };
  }, mid);
  findings.wheelZoomWhileWiring = { ...afterWheel, previewUnchangedByZoom: before === (await page.locator(".wire-draft").getAttribute("d")) };
  await page.screenshot({ path: "test-results/audit-zoom-while-wiring-1280x720.png" });
  await page.mouse.move(mid.x + 3, mid.y + 3);
  findings.wheelZoomWhileWiring.afterNextMove = await page.evaluate(() => Boolean(document.querySelector(".wire-draft")));
  await page.locator("#circuitCanvas").press("Escape");
  findings.escape = { draftStillActive: await draftVisible(), message: await message() };

  // 5. Clicking a part body (not a pin) while wiring.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  const ledBox = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  await page.mouse.click(ledBox.x + ledBox.width / 2, ledBox.y + 4);
  findings.clickPartBodyWhileWiring = { draftStillActive: await draftVisible(), selection: await page.evaluate(() => JSON.stringify(window.__tm4c.workspace.selection)), message: await message() };
  await save("gestures-1280x720", findings);
  expect(errors).toEqual([]);
});

test("hover feedback: same pin, valid target, duplicate connection, tooltip flicker along a header", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await addLed(page);
  const findings = {};
  const a = await centerOf(anchor(page, "board1", "J1.10"));
  const b = await centerOf(anchor(page, "led1", "A"));
  const state = () => page.evaluate(() => ({
    draftInvalid: Boolean(document.querySelector(".wire-draft.invalid")),
    hovered: [...document.querySelectorAll(".pin-anchor:hover")].map((n) => `${n.dataset.part}:${n.dataset.pin}`),
    hoverFill: (() => { const n = document.querySelector(".pin-anchor:hover"); return n ? getComputedStyle(n).fill : null; })(),
    tooltip: document.querySelector("#pinTooltip").hidden ? null : document.querySelector("#pinTooltip").textContent.slice(0, 80),
  }));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(a.x + 1, a.y + 1);
  findings.overSourcePin = await state();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  findings.overValidTarget = await state();
  await page.screenshot({ path: "test-results/audit-hover-valid-1280x720.png" });
  await page.mouse.down();
  await page.mouse.up();
  // Same pair again: already connected.
  await page.mouse.move(a.x, a.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  findings.overDuplicateTarget = await state();
  await page.screenshot({ path: "test-results/audit-hover-duplicate-1280x720.png" });
  await page.mouse.down();
  await page.mouse.up();
  findings.clickDuplicate = { wires: await page.locator(".wire").count(), message: await page.locator("#workspaceMessage").textContent(), draftStillActive: (await page.locator(".wire-draft").count()) > 0 };
  await page.locator("#circuitCanvas").press("Escape");

  // Sweep the pointer slowly down header J1 (pins 1..10): does the tooltip flicker between pins?
  await takeAudit(page);
  const top = await centerOf(anchor(page, "board1", "J1.1"));
  const bottom = await centerOf(anchor(page, "board1", "J1.10"));
  await page.mouse.move(top.x, top.y - 4);
  await page.mouse.move(bottom.x, bottom.y + 4, { steps: 60 });
  findings.headerSweep = await takeAudit(page);
  await save("hover-1280x720", findings);
  expect(errors).toEqual([]);
});

test("segment drag at two zoom levels, with undo and redo", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await addLed(page);
  const findings = [];
  await anchor(page, "board1", "J1.10").click();
  await anchor(page, "led1", "A").click();
  const wire = page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"]');
  await expect(wire).toHaveCount(1);
  for (const zoomIn of [0, 2]) {
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    for (let i = 0; i < zoomIn; i++) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    }
    const segment = await page.evaluate(() => {
      const path = document.querySelector('.wire[data-to="led1:A"] .wire-core');
      const points = [...path.getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const i = Math.floor((points.length - 1) / 2);
      const svg = document.querySelector("#circuitCanvas");
      const p = svg.createSVGPoint();
      p.x = (points[i].x + points[i + 1].x) / 2;
      p.y = (points[i].y + points[i + 1].y) / 2;
      const s = p.matrixTransform(path.getScreenCTM());
      return { x: s.x, y: s.y, horizontal: points[i].y === points[i + 1].y, before: path.getAttribute("d") };
    });
    await takeAudit(page);
    await page.mouse.move(segment.x, segment.y);
    await page.mouse.down();
    const dx = segment.horizontal ? 0 : 50;
    const dy = segment.horizontal ? 50 : 0;
    await page.mouse.move(segment.x + dx, segment.y + dy, { steps: 20 });
    await page.mouse.up();
    const probe = await takeAudit(page);
    const after = await wire.locator(".wire-core").getAttribute("d");
    const routing = await page.evaluate(() => window.__tm4c.diagram.connections[0][3]);
    await page.locator("#circuitCanvas").press("Control+z");
    const undone = await wire.locator(".wire-core").getAttribute("d");
    await page.locator("#circuitCanvas").press("Control+y");
    const redone = await wire.locator(".wire-core").getAttribute("d");
    findings.push({ zoomIn, moved: after !== segment.before, routing, undoRestores: undone === segment.before, redoRestores: redone === after, ...probe });
    await page.screenshot({ path: `test-results/audit-segment-drag-zoom${zoomIn}-1280x720.png` });
    await page.locator("#circuitCanvas").press("Control+z");
  }
  await save("segment-1280x720", findings);
  expect(errors).toEqual([]);
});

test("dense circuit (LCD example): drag a part, drag the board, group drag, pan and wheel zoom", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 }, "lcd1602-hello");
  await expect(page.locator('.part[data-part="lcd1"]')).toHaveCount(1);
  const findings = { wires: await page.locator(".wire").count(), dom: await page.evaluate(() => document.querySelectorAll("#circuitCanvas *").length) };
  const drag = async (locator, dx, dy, steps = 40) => {
    const box = await locator.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await takeAudit(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps });
    await page.mouse.up();
    return takeAudit(page);
  };
  findings.dragLcd = await drag(page.locator('.part[data-part="lcd1"] .part-hitbox'), 120, 40);
  await page.screenshot({ path: "test-results/audit-dense-after-drag-1280x720.png" });
  findings.dragBoard = await drag(page.locator('.part[data-part="board1"] .part-hitbox'), -60, 30);
  await page.locator("#circuitCanvas").press("Control+a");
  findings.groupDrag = await drag(page.locator('.part[data-part="lcd1"] .part-hitbox'), 40, -40);
  await page.locator("#circuitCanvas").press("Escape");
  const canvas = await page.locator("#circuitCanvas").boundingBox();
  await takeAudit(page);
  await page.mouse.move(canvas.x + 20, canvas.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 220, canvas.y + 120, { steps: 40 });
  await page.mouse.up();
  findings.pan = await takeAudit(page);
  const t = await page.evaluate(async () => {
    const svg = document.querySelector("#circuitCanvas");
    const rect = svg.getBoundingClientRect();
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      svg.dispatchEvent(new WheelEvent("wheel", { deltaY: i % 2 ? 120 : -120, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true }));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), max: +times.at(-1).toFixed(3) };
  });
  findings.wheelZoomMs = t;
  findings.undoAll = await page.evaluate(() => {
    const t0 = performance.now();
    while (!document.querySelector("#undoButton").disabled) {
      window.__tm4c.workspace.undo();
    }
    return +(performance.now() - t0).toFixed(2);
  });
  await save("dense-1280x720", findings);
  expect(errors).toEqual([]);
});
