/*
 * Company demo, recorded in one continuous take of the real app: real GCC
 * builds, real Renode execution, real pointer and keyboard input, nothing
 * mocked and no cuts. Each scene waits for the behaviour it shows (the same
 * checks as the showcase tests), so a recording only completes when the app
 * really did it.
 *
 * Frames are what Chromium painted (its screencast, 1920x1080 JPEG), with the
 * time each was painted; demo/make-video.mjs turns them into an MP4 and adds
 * the captions from demo/scenes.json at the recorded scene times. The only
 * addition to the page is a drawn pointer (headless frames have no cursor),
 * which ignores events. The "Load example?" prompt that protects edited work
 * is accepted, as a presenter would.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const OUT = "demo-output";
const { scenes: SCENES } = JSON.parse(await readFile(new URL("./scenes.json", import.meta.url), "utf8"));

/** A pointer that follows the real pointer events, with a ring on each press. */
function pointerOverlay() {
  const install = () => {
    const style = document.createElement("style");
    style.textContent = `
      #demo-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform: translate(-60px, -60px); }
      .demo-press { position: fixed; z-index: 2147483646; pointer-events: none; width: 28px; height: 28px; margin: -14px 0 0 -14px;
        border: 2px solid #58a6ff; border-radius: 50%; animation: demo-press 0.5s ease-out forwards; }
      @keyframes demo-press { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`;
    document.head.append(style);
    const pointer = document.createElement("div");
    pointer.id = "demo-pointer";
    pointer.setAttribute("aria-hidden", "true");
    pointer.innerHTML = '<svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 2 L2 19 L6.4 14.9 L9.4 21.6 L12.3 20.3 L9.3 13.7 L15.2 13.7 Z" fill="#ffffff" stroke="#0d1117" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.append(pointer);
    window.addEventListener("pointermove", (event) => {
      pointer.style.transform = `translate(${event.clientX - 2}px, ${event.clientY - 2}px)`;
    }, true);
    window.addEventListener("pointerdown", (event) => {
      const ring = document.createElement("div");
      ring.className = "demo-press";
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

/** Records painted frames with their timestamps, and the start of each scene. */
async function startRecording(page) {
  await mkdir(`${OUT}/frames`, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `frames/${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    writes.push(writeFile(`${OUT}/${file}`, Buffer.from(data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const marks = [];
  return {
    scene(id) {
      if (!SCENES.some((s) => s.id === id)) {
        throw new Error(`unknown scene ${id}`);
      }
      marks.push({ id, t: Date.now() / 1000 });
    },
    async stop() {
      const end = Date.now() / 1000;
      await cdp.send("Page.stopScreencast");
      await Promise.all(writes);
      await writeFile(`${OUT}/timeline.json`, JSON.stringify({ end, scenes: marks, frames }, null, 1));
      return { frames: frames.length, seconds: end - (frames[0]?.t ?? end) };
    },
  };
}

test("company demo: one take of the real simulator", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript(pointerOverlay);

  const pause = (ms) => page.waitForTimeout(ms);
  const center = async (target) => {
    const box = await (typeof target === "string" ? page.locator(target) : target).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const moveTo = async (target, steps = 22) => {
    const point = target.x !== undefined && target.boundingBox === undefined ? target : await center(target);
    await page.mouse.move(point.x, point.y, { steps });
    return point;
  };
  const click = async (target, before = 300) => {
    await moveTo(target);
    await pause(before);
    await page.mouse.down();
    await page.mouse.up();
  };
  const pin = (part, name) => page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`);
  const row = (gpio) => page.locator(`#pinTable tr[data-pin="${gpio}"]`);
  const chooseExample = async (id) => {
    await moveTo("#exampleSelect");
    await pause(400);
    await page.selectOption("#exampleSelect", id);
    await expect(page.locator("#exampleSelect")).toHaveValue(id);
    await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  };
  const run = async () => {
    await click("#runButton");
    await expect(page.locator("#simulationStatus")).toHaveText("Running");
  };
  const stop = async () => {
    await click("#stopButton");
    await expect(page.locator("#simulationStatus")).not.toHaveText(/Running|Halted/);
  };

  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator("#toolchainInfo")).toContainText("GCC");
  await page.selectOption("#exampleSelect", "three-timers");
  await expect(page.locator("#exampleSelect")).toHaveValue("three-timers");
  await page.mouse.move(640, 420);
  await pause(800);

  const recording = await startRecording(page);
  await page.mouse.move(642, 421); // a first painted frame (the screencast only sends frames on paint)

  // 1. The LaunchPad workspace: the board from TI's CAD data; a header pin's live role.
  recording.scene("workspace");
  await pause(1500);
  await moveTo(page.locator('.part[data-type="tm4c123gxl-launchpad"]'), 30);
  await pause(1200);
  await moveTo(pin("board1", "J3.10"), 26);
  await expect(page.locator("#pinTooltip")).toContainText("J3 pin 10");
  await pause(3500);

  // 2. Real C source: scroll through the timer setup to the three interrupt handlers.
  recording.scene("code");
  await moveTo("#codeEditor", 26);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 200);
    await pause(650);
  }
  // The handlers (lines 71-73) are in view.
  await expect.poll(() => page.evaluate(() => {
    const editor = document.querySelector("#codeEditor");
    const top = Math.floor(editor.scrollTop / parseFloat(getComputedStyle(editor).lineHeight)) + 1;
    return top <= 71 && top + editor.clientHeight / parseFloat(getComputedStyle(editor).lineHeight) >= 74;
  })).toBe(true);
  await pause(2500);

  // 3. GCC compilation: the build result and the ELF sections in the inspector.
  recording.scene("compile");
  await click("#compileButton");
  await expect(page.locator("#editorStatus")).toHaveText("Built");
  await pause(1200);
  await moveTo(".inspector", 20);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 160);
    await pause(350);
  }
  await expect(page.locator(".inspector")).toContainText(".isr_vector");
  await pause(2800);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -160);
    await pause(200);
  }

  // 4. Execution in Renode: three timer interrupts toggle the RGB LED.
  recording.scene("run");
  await run();
  await expect(row("PF1")).toContainText("GPIO output");
  await moveTo(page.locator('.part[data-type="tm4c123gxl-launchpad"]'), 24);
  await pause(9500);

  // 5. Wiring: add an LED and drag a wire from header pin J2.3 to its anode.
  recording.scene("wiring");
  await stop();
  await click(page.getByRole("button", { name: /Part/ }));
  await pause(700);
  await click(page.locator('.library-item[data-type="led"]'));
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await pause(900);
  await moveTo(pin("board1", "J2.3"), 26);
  await pause(500);
  await page.mouse.down();
  await moveTo(pin("led1", "A"), 45);
  await pause(600);
  await page.mouse.up();
  await expect(page.locator(".wire")).toHaveCount(1);
  await expect(page.locator("#workspaceMessage")).toHaveText("Connected board1:J2.3 → led1:A.");
  await pause(3200);

  // 6. External button (example F): hold it, PA6 reads low, the firmware lights the LED on PA7.
  recording.scene("button");
  await chooseExample("external-led-button");
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
  await run();
  await expect(row("PA7")).toContainText("LOW");
  await moveTo(page.locator('.part[data-part="btn1"] .button-cap'), 30);
  await pause(800);
  await page.mouse.down();
  await expect(row("PA7")).toContainText("HIGH");
  await expect(page.locator('.part[data-part="led1"] .part-led')).toHaveClass(/lit/);
  await pause(3000);
  await page.mouse.up();
  await expect(row("PA7")).toContainText("LOW");
  await pause(1500);

  // 7. LCD1602 (example L): the HD44780 model shows what the firmware wrote over Port B.
  recording.scene("lcd");
  await stop();
  await chooseExample("lcd1602-hello");
  await run();
  const lcd = page.locator('.part[data-part="lcd1"] .part-lcd');
  await expect(lcd).toHaveAttribute("data-row0", "Hello, TM4C123! ");
  await moveTo(lcd, 24);
  await expect(lcd).toHaveAttribute("data-row1", /LCD1602 . n=\d/);
  await pause(5500);

  // 8. ADC (example M): the knob sets the voltage on PE3; the firmware picks the LED colour.
  recording.scene("adc");
  await stop();
  await chooseExample("adc-potentiometer");
  await run();
  await expect(row("PF2")).toContainText("HIGH");
  await click(page.locator('.part[data-part="pot1"]'));
  const slider = page.locator("#potPosition");
  await expect(slider).toBeVisible();
  const track = await slider.boundingBox();
  const at = (percent) => ({ x: track.x + 8 + (track.width - 16) * percent / 100, y: track.y + track.height / 2 });
  await moveTo(at(50), 24);
  await page.mouse.down();
  await moveTo(at(15), 30);
  await page.mouse.up();
  await expect(row("PF3")).toContainText("HIGH");
  await pause(2200);
  await moveTo(at(15), 6);
  await page.mouse.down();
  await moveTo(at(95), 40);
  await page.mouse.up();
  await expect(row("PF1")).toContainText("HIGH");
  await expect(row("PE3")).toContainText("pot1 → AIN0");
  await pause(2800);

  // 9. Diagnostics: a typo, GCC's error with its suggestion, jump to the line, fix, clean build.
  recording.scene("diagnostics");
  await stop();
  const typoAt = await page.evaluate(() => {
    const editor = document.querySelector("#codeEditor");
    const index = editor.value.indexOf("? GREEN_LED :") + "? GREEN_LED".length;
    const line = editor.value.slice(0, index).split("\n").length;
    editor.scrollTop = Math.max(0, (line - 6) * parseFloat(getComputedStyle(editor).lineHeight));
    editor.dispatchEvent(new Event("scroll"));
    return index;
  });
  await moveTo("#codeEditor", 20);
  await page.evaluate((index) => {
    const editor = document.querySelector("#codeEditor");
    editor.focus();
    editor.setSelectionRange(index, index);
  }, typoAt);
  await pause(700);
  await page.keyboard.type("S", { delay: 120 });
  await pause(900);
  await click("#compileButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0");
  await expect(page.getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
  const error = page.locator("#problemsOutput .problem-row.error").first();
  await expect(error).toContainText("GREEN_LEDS");
  await pause(2500);
  await click(error);
  await expect.poll(() => page.evaluate(() => {
    const editor = document.querySelector("#codeEditor");
    return editor.value.slice(editor.selectionStart, editor.selectionEnd);
  })).toBe("GREEN_LEDS");
  await pause(1000);
  await page.keyboard.type("GREEN_LED", { delay: 70 });
  await pause(600);
  await click("#compileButton");
  await expect(page.locator("#editorStatus")).toHaveText("Built");
  await expect(page.locator("#problemCount")).toHaveText("0");
  await pause(1500);

  // 10. Console: messages by severity and source; then the honest limits in the notice bar.
  recording.scene("console");
  await click(page.getByRole("tab", { name: /Console/ }));
  await pause(800);
  await click(page.locator("#consoleTools .console-chip", { hasText: "Detailed" }));
  await pause(1600);
  await click(page.locator("#consoleTools .console-chip", { hasText: "Compact" }));
  await pause(900);
  await moveTo("#modeNotice", 30);
  await pause(4500);

  const result = await recording.stop();
  console.log(`::notice title=demo recording::${result.frames} frames, ${result.seconds.toFixed(1)} s`);
  expect(errors).toEqual([]);
});
