/*
 * Firmware editor colouring: the textarea keeps all editing (caret,
 * selection, Tab, F8, problem marks) while a coloured copy of the same
 * characters is drawn under its transparent text, at the same scroll
 * position. Screenshots at three sizes.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  return errors;
}

/** The coloured layer's text equals the source, and both are scrolled alike. */
const layer = (page) => page.evaluate(() => {
  const editor = document.querySelector("#codeEditor");
  const colours = document.querySelector("#codeHighlight");
  // A final newline gets one space in the layer, so it is as tall as the textarea.
  const expected = editor.value.endsWith("\n") || editor.value === "" ? `${editor.value} ` : editor.value;
  return {
    same: colours.textContent === expected,
    scrollTop: [editor.scrollTop, colours.scrollTop],
    kinds: [...new Set([...colours.querySelectorAll("span")].map((span) => span.className))].sort(),
    textColor: getComputedStyle(editor).webkitTextFillColor,
    caret: getComputedStyle(editor).caretColor,
    font: [getComputedStyle(editor).font, getComputedStyle(colours).font],
  };
});

for (const size of SIZES) {
  test(`the code is coloured by kind and lines up with the editor, at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    await page.selectOption("#exampleSelect", "three-timers");
    const state = await layer(page);
    expect(state.same).toBe(true);
    expect(state.kinds).toEqual(expect.arrayContaining(["tok-comment", "tok-preprocessor", "tok-keyword", "tok-type", "tok-number", "tok-constant", "tok-function"]));
    expect(state.textColor).toBe("rgba(0, 0, 0, 0)");
    expect(state.caret).not.toBe("rgba(0, 0, 0, 0)");
    expect(state.font[0]).toBe(state.font[1]);
    await page.locator(".editor-panel").screenshot({ path: `test-results/ux-editor-${size.width}x${size.height}.png` });
    expect(errors).toEqual([]);
  });
}

test("typing, Tab, scrolling and problem navigation keep the colours aligned", async ({ page }) => {
  const errors = await open(page);
  const editor = page.locator("#codeEditor");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n/* added */ int extra_value = 0x10;");
  await page.keyboard.press("Tab");
  let state = await layer(page);
  expect(state.same).toBe(true);
  await expect(page.locator("#codeHighlight .tok-comment", { hasText: "/* added */" })).toHaveCount(1);
  await expect(page.locator("#codeHighlight .tok-number", { hasText: "0x10" })).toHaveCount(1);

  // Scrolled to the end and back: the layer follows.
  await editor.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect.poll(async () => { const s = await layer(page); return s.scrollTop[0] === s.scrollTop[1] && s.scrollTop[0] > 0; }).toBe(true);
  await editor.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(async () => (await layer(page)).scrollTop[1]).toBe(0);

  // A build error: the problem line is marked over the colours, F8 selects the identifier.
  const source = await editor.inputValue();
  await page.fill("#codeEditor", source.replace(/int\s+main\s*\(\s*void\s*\)\s*\{/, "int main(void)\n{\n    undeclared_symbol = 1;"));
  await page.click("#compileButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0", { timeout: 90_000 });
  state = await layer(page);
  expect(state.same).toBe(true);
  await expect(page.locator("#editorHighlight")).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("F8");
  expect(await editor.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe("undeclared_symbol");
  await page.locator(".editor-panel").screenshot({ path: "test-results/ux-editor-problem-1280x720.png" });
  expect(errors).toEqual([]);
});
