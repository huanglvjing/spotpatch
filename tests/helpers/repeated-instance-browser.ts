import { expect, type Page } from "@playwright/test";

/** Shared contract, exercised against real framework-generated source markers. */
export async function verifyRepeatedInstanceSelection(page: Page): Promise<void> {
  const actions = page.getByTestId("repeated-edit");
  await expect(actions).toHaveCount(20);
  const markers = await actions.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-spotpatch-source")),
  );
  expect(markers[0]).toMatch(/^[\w-]+:\d+:\d+(?::astro)?$/u);
  expect(new Set(markers).size).toBe(1);
  await page.getByRole("button", { name: "Select element", exact: true }).click();
  await actions.nth(2).click();
  const planner = page.getByRole("dialog", { name: "Plan the change" });
  await expect(planner.locator(".spotpatch-target-item")).toHaveCount(1);
  await planner
    .locator("textarea[data-target-instruction-id]")
    .fill("Change product 3 only.");
  await planner.getByRole("button", { name: "Add element" }).click();
  await actions.nth(6).click();
  await expect(planner.locator(".spotpatch-target-item")).toHaveCount(2);
  await planner
    .locator("textarea[data-target-instruction-id]")
    .fill("Change product 7 only.");
  await planner.getByRole("button", { name: "Add element" }).click();
  await actions.nth(2).click();
  await expect(planner.locator(".spotpatch-target-item")).toHaveCount(2);
  await expect(planner.locator("textarea[data-target-instruction-id]")).toHaveValue(
    "Change product 3 only.",
  );
  await expect(planner.getByRole("button", { name: "Preview prompt" })).toBeEnabled();
  await planner.getByRole("button", { name: "Preview prompt" }).click();
  const prompt = page.getByLabel("Generated prompt");
  await expect(prompt).toContainText("Product 3");
  await expect(prompt).toContainText("Product 7");
  const text = (await prompt.textContent()) ?? "";
  const instances = [
    ...text.matchAll(/^- Captured instance[^\n]*?: (\{[^\n]+\})$/gmu),
  ].map(
    (match) =>
      JSON.parse(match[1] ?? "null") as {
        id: string;
        selector: string;
        context: string;
        state: string;
        selectorStatus: string;
      },
  );
  expect(instances).toHaveLength(2);
  expect(new Set(instances.map((instance) => instance.id)).size).toBe(2);
  for (const [index, instance] of instances.entries()) {
    expect(instance.state).toBe("captured");
    expect(instance.selectorStatus).toBe("unique-at-capture");
    expect(instance.context.replace(/\s+/gu, " ")).toContain(
      index === 0 ? "Product 3" : "Product 7",
    );
    await expect(page.locator(instance.selector)).toHaveCount(1);
    expect(
      await page
        .locator(instance.selector)
        .evaluate((element) => element.closest("article")?.textContent),
    ).toContain(index === 0 ? "Product 3" : "Product 7");
  }
}
