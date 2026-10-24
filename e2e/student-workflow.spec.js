/*
 * End-to-end student workflow with real GCC and Renode, at three viewport
 * sizes. One session goes through every part of the UX work:
 *   1. open example F (external LED + button): its wires cross no pin pad;
 *   2. add an LED and wire it by drag-to-connect and by clicks: clean routes,
 *      each equal to its preview, and the pin tooltip names the new wire at once;
 *   3. break the code: the build fails, the Problems list goes to the line;
 *      fix it and run;
 *   4. press the external button: the firmware lights the LED;
 *   5. the console is readable: one error (the failed build), GPIO changes folded;
 *   6. save diagram.json, reload the page: the work, routes included, is back.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const G = 9.6;
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

async function open(page, size) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  return errors;
}

/** Screen centre of a pin, checked to be what a click there reaches. */
async function pin(page, endpoint) {
  const hit = await page.evaluate((id) => {
    const [part, name] = id.split(":");
    const node = document.querySelector(`.pin-anchor[data-part="${CSS.escape(part)}"][data-pin="${CSS.escape(name)}"]`);
    const r = node.getBoundingClientRect();
    const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    return { ...point, reachable: document.elementFromPoint(point.x, point.y) === node };
  }, endpoint);
  expect(hit.reachable, `${endpoint} is clickable`).toBe(true);
  return hit;
}

/** Unrelated pin pads each wire's drawn path passes over, by coordinates. */
const padCrossings = (page) => page.evaluate((grid) => {
  const ws = window.__tm4c.workspace;
  const pads = [...document.querySelectorAll(".pin-anchor")].map((n) => ({ id: `${n.dataset.part}:${n.dataset.pin}`, ...ws.pinPosition(`${n.dataset.part}:${n.dataset.pin}`) }));
  const dist = (p, a, b) => {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1)));
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
  };
  return [...document.querySelectorAll(".wire")].flatMap((w) => {
    const points = [...w.querySelector(".wire-core").getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const own = new Set([w.dataset.from, w.dataset.to]);
    return pads.filter((p) => !own.has(p.id) && points.some((q, i) => i > 0 && dist(p, points[i - 1], q) < 0.45 * grid)).map((p) => `${w.dataset.from}→${w.dataset.to} over ${p.id}`);
  });
}, G);

const shot = (page, tag, name) => page.screenshot({ path: `test-results/student-${tag}-${name}.png` });
const coreD = (page, from, to) => page.locator(`.wire[data-from="${from}"][data-to="${to}"] .wire-core`).getAttribute("d");

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test(`a student's session from example to running firmware, at ${tag}`, async ({ page }) => {
    const errors = await open(page, size);
    const message = page.locator("#workspaceMessage");

    // 1. Example F: clean wires as shipped.
    await page.selectOption("#exampleSelect", "external-led-button");
    await expect(page.locator(".wire")).toHaveCount(5);
    expect(await padCrossings(page)).toEqual([]);
    await page.mouse.move(2, 2);
    await shot(page, tag, "1-example");

    // 2. Add an LED; wire its anode by dragging from J2.3, its cathode by two clicks to GND (J2.1).
    await page.getByRole("button", { name: /Part/ }).click();
    await page.locator('.library-item[data-type="led"]').click();
    await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
    await page.locator("#circuitCanvas").press("Escape");
    const a = await pin(page, "board1:J2.3");
    const anode = await pin(page, "led2:A");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(anode.x, anode.y, { steps: 10 });
    await expect(message).toContainText("release on a target pin");
    const dragPreview = await page.locator(".wire-draft").getAttribute("d");
    await page.mouse.up();
    await expect(message).toHaveText("Connected board1:J2.3 → led2:A.");
    expect(await coreD(page, "board1:J2.3", "led2:A")).toBe(dragPreview);
    // The tooltip under the unmoved pointer already names the new wire.
    await expect(page.locator("#pinTooltip")).toContainText("Wired to board1:J2.3");

    await page.mouse.move(2, 2); // no tooltip over the next pin
    const cathode = await pin(page, "led2:C");
    await page.mouse.click(cathode.x, cathode.y);
    await expect(message).toContainText("click a target pin");
    await page.mouse.move(2, 2); // the wire waits for its target; no tooltip over it
    const ground = await pin(page, "board1:J2.1");
    await page.mouse.move(ground.x, ground.y, { steps: 6 });
    const clickPreview = await page.locator(".wire-draft").getAttribute("d");
    await page.mouse.click(ground.x, ground.y);
    await expect(message).toHaveText("Connected led2:C → board1:J2.1.");
    expect(await coreD(page, "led2:C", "board1:J2.1")).toBe(clickPreview);
    await expect(page.locator("#pinTooltip")).toContainText("Wired to");
    await expect(page.locator(".wire")).toHaveCount(7);
    expect(await padCrossings(page)).toEqual([]);
    await page.mouse.move(2, 2);
    await shot(page, tag, "2-wired");

    // 3. Break the code: the build fails and the Problems list goes to the line; fix it and run.
    const source = await page.inputValue("#codeEditor");
    const lines = source.split("\n");
    const brace = lines.findIndex((line, i) => i > 0 && /int\s+main\s*\(\s*void\s*\)/.test(lines[i - 1]) && line.trim() === "{");
    expect(brace).toBeGreaterThan(0);
    const brokenLine = brace + 2; // 1-based number of the inserted line
    await page.fill("#codeEditor", [...lines.slice(0, brace + 1), "    int broken = ;", ...lines.slice(brace + 1)].join("\n"));
    await page.click("#runButton");
    await expect(page.locator("#editorStatus")).toHaveText(/^Build failed: 1 error/, { timeout: 90_000 });
    await expect(page.getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#simulationStatus")).toHaveText("No firmware running");
    await page.locator("#problemsOutput button.problem-row").first().click();
    const cursor = await page.evaluate(() => {
      const editor = document.querySelector("#codeEditor");
      return { line: editor.value.slice(0, editor.selectionStart).split("\n").length, selected: editor.value.slice(editor.selectionStart, editor.selectionEnd) };
    });
    expect(cursor.line).toBe(brokenLine);
    await shot(page, tag, "3-problem");
    await page.fill("#codeEditor", source);
    await page.click("#runButton");
    await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 90_000 });

    // 4. Press the external button: the firmware drives PA7 and the LED lights; release: off.
    await expect(page.locator(".part-led.lit")).toHaveCount(0);
    await page.locator('.part[data-part="btn1"] .button-cap').hover();
    await page.mouse.down();
    await expect(page.locator('.part[data-part="led1"] .part-led')).toHaveClass(/lit/, { timeout: 60_000 });
    await shot(page, tag, "4-button-held");
    await page.mouse.up();
    await expect(page.locator(".part-led.lit")).toHaveCount(0, { timeout: 60_000 });

    // 5. The console: the failed build is the one error; GPIO changes are folded in the compact view.
    await page.getByRole("tab", { name: /Console/ }).click();
    await expect(page.locator("#consoleErrorCount")).toHaveText("1");
    const levels = await page.locator("#consoleOutput > .console-line").evaluateAll((rows) => rows.map((r) => r.dataset.level));
    expect(levels.filter((l) => l === "error")).toHaveLength(1);
    await expect(page.locator("#consoleOutput")).toContainText("Build failed");
    await expect(page.locator("#consoleOutput")).toContainText("Build succeeded");
    await shot(page, tag, "5-console");
    await page.click("#stopButton");
    await expect(page.locator("#simulationStatus")).not.toHaveText("Running");

    // 6. Save diagram.json, reload the page: the circuit, routes included, comes back from this browser.
    const serialized = await page.evaluate(() => window.__tm4c.serialize());
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save" }).click();
    const saved = await readFile(await (await downloadPromise).path(), "utf8");
    expect(saved).toBe(serialized);
    expect(JSON.parse(saved).connections.filter((c) => c[0].startsWith("led2") || c[1].startsWith("led2"))).toHaveLength(2);
    await page.reload();
    await expect(page.locator("#exampleSelect option")).toHaveCount(14);
    await expect(page.locator(".wire")).toHaveCount(7);
    expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(saved);
    expect(await page.inputValue("#codeEditor")).toBe(source);
    expect(await padCrossings(page)).toEqual([]);
    await page.mouse.move(2, 2);
    await shot(page, tag, "6-restored");
    expect(errors).toEqual([]);
  });
}
