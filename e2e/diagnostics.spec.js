/*
 * Compiler problems in the editor, with real arm-none-eabi-gcc builds: every
 * problem with a line in main.c goes to its line and column (the identifier
 * or symbol there is selected and the line is marked); several problems and
 * their notes are listed, marked in the gutter, and reachable with F8 and
 * Shift+F8; linker errors without a line are listed but never pretend to
 * have one; compiler text is shown as text, never as HTML.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

const BROKEN = [
  "#include <stdint.h>",
  "",
  "static int helper(int a)",
  "{",
  "    int unused = 3;",
  "    return a;",
  "}",
  "",
  "int main(void)",
  "{",
  "    uint32_t value = 1u",
  "    value = undeclared_identifier;",
  "    helper((int)value);",
  "    for (;;)",
  "    {",
  "    }",
  "}",
  "",
].join("\n");

const LINK_ERROR = [
  "void missing_function(void);",
  "",
  "int main(void)",
  "{",
  "    missing_function();",
  "    for (;;)",
  "    {",
  "    }",
  "}",
  "",
].join("\n");

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  return errors;
}

async function build(page, source) {
  await page.fill("#codeEditor", source);
  await page.click("#compileButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0", { timeout: 90_000 });
  await expect(page.locator("#editorStatus")).toContainText("Build failed", { timeout: 90_000 });
}

/** The Problems rows as the page shows them. */
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("#problemsOutput .problem-row")].map((row) => ({
  button: row.tagName === "BUTTON",
  note: row.classList.contains("note"),
  severity: ["error", "warning", "note"].find((s) => row.classList.contains(s)) ?? null,
  location: row.querySelector(".problem-location")?.textContent ?? null,
  message: row.querySelector(".problem-message")?.textContent ?? row.textContent,
})));

/** Cursor line and column, the selected text, and whether the marked line sits exactly on that line. */
const editorState = (page) => page.evaluate(() => {
  const editor = document.querySelector("#codeEditor");
  const before = editor.value.slice(0, editor.selectionStart).split("\n");
  const line = before.length;
  const band = document.querySelector("#editorHighlight");
  const style = getComputedStyle(editor);
  const height = parseFloat(style.lineHeight);
  const expectedTop = editor.getBoundingClientRect().top + parseFloat(style.paddingTop) + (line - 1) * height - editor.scrollTop;
  return {
    focused: document.activeElement === editor,
    line,
    column: before.at(-1).length + 1,
    selected: editor.value.slice(editor.selectionStart, editor.selectionEnd),
    lineText: editor.value.split("\n")[line - 1],
    bandVisible: !band.hidden,
    bandOnLine: !band.hidden && Math.abs(band.getBoundingClientRect().top - expectedTop) < 1,
    bandSeverity: band.dataset.severity ?? null,
  };
});

const parseLocation = (location) => {
  const match = /^main\.c:(\d+)(?::(\d+))?$/.exec(location);
  return match ? { line: Number(match[1]), column: match[2] ? Number(match[2]) : null } : null;
};

test("several problems: each goes to its line and column, marked in the gutter, with F8 and Shift+F8", async ({ page }) => {
  const errors = await open(page);
  await build(page, BROKEN);
  await expect(page.getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
  const list = await rows(page);
  const problems = list.filter((r) => !r.note);
  expect(problems.filter((r) => r.severity === "error").length, JSON.stringify(list)).toBeGreaterThanOrEqual(2);
  expect(problems.some((r) => r.severity === "warning" && /unused/.test(r.message)), JSON.stringify(list)).toBe(true);
  await expect(page.locator("#editorStatus")).toHaveText(/^Build failed: \d+ errors?, \d+ warnings?$/);

  // The first error's line is marked right after the build, without taking focus from the Compile button.
  let state = await editorState(page);
  expect(state.focused).toBe(false);
  expect(state.bandVisible).toBe(true);
  await page.screenshot({ path: "test-results/diagnostics-after-build-1280x720.png" });

  // Every row with a location goes there: the cursor on its line, the token at its column selected.
  const lines = BROKEN.split("\n");
  for (const [index, row] of list.entries()) {
    const at = parseLocation(row.location);
    expect(row.button, `${row.location} is a link exactly when it has a main.c line`).toBe(at !== null);
    if (!at) {
      continue;
    }
    await page.locator("#problemsOutput .problem-row").nth(index).click();
    state = await editorState(page);
    expect(state.focused).toBe(true);
    expect(state.line, row.location).toBe(at.line);
    expect(state.bandOnLine, `${row.location}: the marked line is the problem's line`).toBe(true);
    expect(state.bandSeverity).toBe(row.severity);
    if (at.column) {
      expect(state.column, row.location).toBe(at.column);
      const token = /^\w+/.exec(lines[at.line - 1].slice(at.column - 1))?.[0] ?? lines[at.line - 1][at.column - 1];
      expect(state.selected, row.location).toBe(token);
    } else {
      expect(state.selected).toBe(lines[at.line - 1].trim());
    }
  }
  await page.screenshot({ path: "test-results/diagnostics-navigated-1280x720.png" });

  // Gutter: every problem line is marked, with its messages on hover.
  const located = list.map((r) => parseLocation(r.location)).filter(Boolean);
  const marks = await page.evaluate(() => [...document.querySelectorAll("#lineNumbers .gutter-mark")].map((m) => ({ line: Number(m.textContent), title: m.title, stale: m.classList.contains("stale") })));
  expect(marks.map((m) => m.line).sort((a, b) => a - b)).toEqual([...new Set(located.map((l) => l.line))].sort((a, b) => a - b));
  expect(marks.every((m) => m.title.length > 0 && !m.stale)).toBe(true);

  // F8 from the top visits the problem lines in order and wraps; Shift+F8 goes back.
  const problemLines = [...new Set(list.filter((r) => !r.note).map((r) => parseLocation(r.location)).filter(Boolean).map((l) => l.line))].sort((a, b) => a - b);
  expect(problemLines.length).toBeGreaterThan(1);
  await page.evaluate(() => {
    const editor = document.querySelector("#codeEditor");
    editor.focus();
    editor.setSelectionRange(0, 0);
  });
  const visited = [];
  for (let i = 0; i <= problemLines.length; i++) {
    await page.keyboard.press("F8");
    visited.push((await editorState(page)).line);
  }
  expect(visited).toEqual([...problemLines, problemLines[0]]);
  await page.keyboard.press("Shift+F8");
  expect((await editorState(page)).line).toBe(problemLines.at(-1));

  // Editing clears the marked line and dims the gutter marks (lines may have moved).
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  state = await editorState(page);
  expect(state.bandVisible).toBe(false);
  expect(await page.locator("#lineNumbers .gutter-mark.stale").count()).toBe(marks.length);
  await expect(page.locator("#editorStatus")).toHaveText("Not built");
  expect(errors).toEqual([]);
});

test("a linker error is listed as such and never given an invented line", async ({ page }) => {
  const errors = await open(page);
  await build(page, LINK_ERROR);
  const list = await rows(page);
  const undefinedRef = list.find((r) => /undefined reference to [`']missing_function'/.test(r.message));
  expect(undefinedRef, JSON.stringify(list)).toBeTruthy();
  expect(undefinedRef.severity).toBe("error");
  const at = parseLocation(undefinedRef.location);
  if (at) {
    // The linker took the line from debug info: it must be the call.
    expect(LINK_ERROR.split("\n")[at.line - 1]).toContain("missing_function();");
    await page.locator("#problemsOutput .problem-row", { hasText: "undefined reference" }).click();
    expect((await editorState(page)).lineText).toContain("missing_function();");
  } else {
    expect(undefinedRef.button).toBe(false);
  }
  // "ld returned 1 exit status" has no location: listed, not a link.
  const summaryRow = list.find((r) => /ld returned 1 exit status/.test(r.message));
  expect(summaryRow, JSON.stringify(list)).toBeTruthy();
  expect(summaryRow).toMatchObject({ button: false, location: "linker" });
  await page.getByRole("tab", { name: /Problems/ }).click();
  await page.screenshot({ path: "test-results/diagnostics-linker-1280x720.png" });
  console.log(`::notice title=linker problem::${JSON.stringify(list)}`);
  expect(errors).toEqual([]);
});

test("compiler text is shown as text, never as HTML", async ({ page }) => {
  const errors = await open(page);
  const payload = '<img src=x onerror="window.__xss=1"><b id="injected">bold</b>';
  await build(page, `#error ${payload}\nint main(void) { for (;;) {} }\n`);
  const list = await rows(page);
  expect(list.some((r) => r.message.includes(payload)), JSON.stringify(list)).toBe(true);
  expect(await page.locator("#problemsOutput img, #problemsOutput b, #consoleOutput img, #consoleOutput b, #lineNumbers img").count()).toBe(0);
  expect(await page.locator("#injected").count()).toBe(0);
  const title = await page.locator("#lineNumbers .gutter-mark").first().getAttribute("title");
  expect(title).toContain(payload);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

for (const size of SIZES) {
  test(`problems list and marked line at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    await build(page, BROKEN);
    await page.locator("#problemsOutput button.problem-row").first().click();
    const state = await editorState(page);
    expect(state.bandOnLine).toBe(true);
    // The marked line stays on its line while the editor scrolls.
    await page.evaluate(() => { document.querySelector("#codeEditor").scrollTop = 40; });
    expect((await editorState(page)).bandOnLine).toBe(true);
    await page.evaluate(() => { document.querySelector("#codeEditor").scrollTop = 0; });
    await page.screenshot({ path: `test-results/diagnostics-${size.width}x${size.height}.png` });
    expect(errors).toEqual([]);
  });
}
