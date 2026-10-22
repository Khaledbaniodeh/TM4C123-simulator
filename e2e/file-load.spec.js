/*
 * Loading a diagram file never silently replaces the student's circuit: a
 * valid file over edited circuit work asks first, and Cancel keeps the
 * circuit, selection, undo/redo, main.c, the stored drafts, and the example
 * exactly. Confirming loads as before (draft updated, reload restores it).
 * Invalid files, a cancelled picker, untouched circuits, and identical files
 * never ask. Load is used from the keyboard (Enter and Space) throughout.
 */
import { expect, test } from "@playwright/test";

const DIAGRAM_KEY = "tm4c123-simulator:diagram-draft";
const SOURCE_KEY = "tm4c123-simulator:source-draft";

/** A valid diagram.json: the bare LaunchPad plus one LED with the given id. */
const ledFile = (id, left = -192) => JSON.stringify({
  version: 1,
  parts: [
    { type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0, rotate: 0, attrs: {} },
    { type: "led", id, top: 96, left, rotate: 0, attrs: { color: "green" } },
  ],
  connections: [],
});

async function open(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator("#exampleSummary")).not.toBeEmpty();
  return errors;
}

/** Chooses `files` through the Load button, activated with `key` (Enter or Space). */
async function loadWithKeyboard(page, files, key = "Enter") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Load diagram.json", exact: true }).focus();
  await page.keyboard.press(key);
  await (await chooser).setFiles(files);
}
const file = (name, text) => ({ name, mimeType: "application/json", buffer: Buffer.from(text) });

/** Everything a cancelled load must leave untouched. */
const snapshot = (page) => page.evaluate(([diagramKey, sourceKey]) => ({
  circuit: window.__tm4c.serialize(),
  selection: JSON.stringify(window.__tm4c.workspace.selection),
  undo: !document.querySelector("#undoButton").disabled,
  redo: !document.querySelector("#redoButton").disabled,
  source: document.querySelector("#codeEditor").value,
  example: document.querySelector("#exampleSelect").value,
  diagramDraft: localStorage.getItem(diagramKey),
  sourceDraft: localStorage.getItem(sourceKey),
}), [DIAGRAM_KEY, SOURCE_KEY]);

/** Example F with an edited main.c, an added LED, a rotation undone (so redo exists), and r1 selected. */
async function editedWork(page) {
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
  await page.fill("#codeEditor", `${await page.inputValue("#codeEditor")}\n/* my work */\n`);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await page.locator("#circuitCanvas").press("r");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "r1" }));
}

test("edited circuit: Load asks first, and Cancel keeps everything exactly", async ({ page }) => {
  const errors = await open(page);
  await editedWork(page);
  const before = await snapshot(page);
  expect(before.redo).toBe(true);

  const prompts = [];
  page.once("dialog", (dialog) => {
    prompts.push(dialog.message());
    dialog.dismiss();
  });
  await loadWithKeyboard(page, file("other.json", ledFile("led9")));
  await expect(page.locator("#workspaceMessage")).toHaveText("Kept your circuit; other.json was not loaded.");
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('Load "other.json"?');
  expect(prompts[0]).toContain("replaces your current circuit and clears its undo history");
  expect(prompts[0]).toContain("Your main.c is not changed");
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.part[data-part="led9"]')).toHaveCount(0);

  // Undo and redo still work on the kept history.
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('.part[data-part="led2"]')).toHaveAttribute("transform", /rotate\(90/);
  expect(errors).toEqual([]);
});

test("Confirm loads the file: draft updated, main.c unchanged, reload restores it", async ({ page }) => {
  const errors = await open(page);
  await editedWork(page);
  const before = await snapshot(page);

  page.once("dialog", (dialog) => dialog.accept());
  await loadWithKeyboard(page, file("other.json", ledFile("led9")), "Space");
  await expect(page.locator("#workspaceMessage")).toHaveText("Loaded other.json.");
  await expect(page.locator('.part[data-part="led9"]')).toHaveCount(1);
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.diagramDraft).toBe(after.circuit);
  expect(after.source).toBe(before.source);
  expect(after.sourceDraft).toBe(before.sourceDraft);
  expect(after.example).toBe(before.example);
  expect(after.undo).toBe(false);

  // Editing continues with undo/redo.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led9" }));
  await page.locator("#circuitCanvas").press("r");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(after.circuit);

  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-part="led9"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(after.circuit);
  expect(await page.inputValue("#codeEditor")).toBe(before.source);
  expect(errors).toEqual([]);
});

test("invalid files and a cancelled picker never ask and never replace work", async ({ page }) => {
  const errors = await open(page);
  await editedWork(page);
  const before = await snapshot(page);
  const prompts = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    dialog.dismiss();
  });

  await loadWithKeyboard(page, file("bad.json", '{"version":1,"parts":[],"connections":[["x:1","y:2","red",[]]]}'));
  await expect(page.locator("#workspaceMessage")).toContainText("Could not load bad.json");
  expect(await snapshot(page)).toEqual(before);
  await loadWithKeyboard(page, file("broken.json", "{ not json"), "Space");
  await expect(page.locator("#workspaceMessage")).toContainText("Could not load broken.json");
  expect(await snapshot(page)).toEqual(before);

  await loadWithKeyboard(page, []); // the picker was cancelled
  expect(await snapshot(page)).toEqual(before);
  expect(prompts).toEqual([]);
  expect(errors).toEqual([]);
});

test("untouched circuits, files over files, and identical files load without asking", async ({ page }) => {
  const errors = await open(page);
  const prompts = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    dialog.dismiss();
  });

  // The example's own circuit is not student work: no question.
  await loadWithKeyboard(page, file("a.json", ledFile("led7")));
  await expect(page.locator('.part[data-part="led7"]')).toHaveCount(1);
  // A file loaded over the previous file (unchanged since): no question.
  await loadWithKeyboard(page, file("b.json", ledFile("led8", -288)), "Space");
  await expect(page.locator('.part[data-part="led8"]')).toHaveCount(1);
  // The same file again: identical, so nothing changes and undo history stays.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led8" }));
  await page.locator("#circuitCanvas").press("r");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#redoButton")).toBeEnabled();
  await loadWithKeyboard(page, file("b.json", ledFile("led8", -288)));
  await expect(page.locator("#workspaceMessage")).toHaveText("b.json matches the current circuit; nothing changed.");
  await expect(page.locator("#redoButton")).toBeEnabled();
  expect(prompts).toEqual([]);

  // After an edit to the loaded circuit, loading asks.
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await loadWithKeyboard(page, file("a.json", ledFile("led7")));
  await expect.poll(() => prompts.length).toBe(1);
  await expect(page.locator("#workspaceMessage")).toHaveText("Kept your circuit; a.json was not loaded.");
  await expect(page.locator('.part[data-part="led8"]')).toHaveAttribute("transform", /rotate\(90/);
  expect(errors).toEqual([]);
});
