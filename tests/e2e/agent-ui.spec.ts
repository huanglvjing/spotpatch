import { expect, test } from "@playwright/test";

test("opens the customizable Agent selector below its field", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByTestId("tailwind-button").click();
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  const provider = dialog.getByLabel("AI provider");

  await expect(provider).toBeVisible();
  await expect(provider).toHaveCSS("appearance", "base-select");
  await provider.scrollIntoViewIfNeeded();
  await expect(provider).toBeInViewport();
  await provider.click();
  await expect
    .poll(() => provider.evaluate((element) => element.matches(":open")))
    .toBe(true);
  const option = dialog.getByRole("option", { name: "E2E Relay" });
  const [fieldBox, optionBox] = await Promise.all([
    provider.boundingBox(),
    option.boundingBox(),
  ]);

  expect(fieldBox).not.toBeNull();
  expect(optionBox).not.toBeNull();

  if (fieldBox !== null && optionBox !== null) {
    expect(optionBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 2);
  }

  await option.click();
  await expect
    .poll(() => provider.evaluate((element) => element.matches(":open")))
    .toBe(false);
});
