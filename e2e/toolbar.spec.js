/*
 * Circuit toolbar geometry and appearance at three viewport sizes: every
 * button's position and size is recorded (GitHub notice) and the toolbar is
 * captured, so visual changes to toolbar icons can be compared before/after.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

for (const size of SIZES) {
  test(`circuit toolbar at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator("#exampleSelect option")).toHaveCount(14);
    await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();

    const geometry = () => page.evaluate(() =>
      [...document.querySelectorAll(".simulator-toolbar button, .simulator-toolbar label.file-button")].map((node) => {
        const r = node.getBoundingClientRect();
        return `${node.id || node.textContent.trim()}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`;
      }).join(" "));

    const disabled = await geometry();
    console.log(`::notice title=toolbar ${size.width}x${size.height} (nothing selected)::${disabled}`);
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-disabled.png` });

    // Select a part so Delete is enabled.
    await page.getByRole("button", { name: /Part/ }).click();
    await page.locator('.library-item[data-type="led"]').click();
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeEnabled();
    const enabled = await geometry();
    expect(enabled, "enabling buttons does not move them").toBe(disabled);
    await page.getByRole("button", { name: "Delete selection" }).hover();
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-hover.png` });
    await page.getByRole("button", { name: "Delete selection" }).focus();
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-focus.png` });

    // Clicking Delete still removes the selected part.
    await page.getByRole("button", { name: "Delete selection" }).click();
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
