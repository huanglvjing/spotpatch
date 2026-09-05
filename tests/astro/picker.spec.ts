import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("selects native Astro source, preserves scripts/styles and survives navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/models/");
  await expect(page.locator("#counter")).toHaveAttribute(
    "data-spotpatch-source",
    /^[\w-]+:7:3:astro$/u,
  );
  await expect(page.locator(".card")).toHaveAttribute(
    "data-spotpatch-source",
    /^[\w-]+:4:1:astro$/u,
  );
  await expect(page.locator(".card")).toHaveCSS("border-top-width", "2px");
  await page.locator("#counter").click();
  await expect(page.locator("#counter")).toHaveText("Count 1");
  await page.getByRole("button", { name: "选择元素", exact: true }).click();
  await page.locator("#counter").click();
  await expect(page.locator(".spotpatch-summary")).toContainText(
    "components/Card.astro:7:3",
  );
  await expect(page.locator(".spotpatch-summary")).toContainText("astro-host");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.locator("#second")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select element", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Select element", exact: true }).click();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.locator("#second").click();
  await expect(page.locator(".spotpatch-summary")).toContainText("pages/second.astro");
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await dialog
    .locator("textarea[data-target-instruction-id]")
    .fill("Make this heading clearer.");
  await dialog.getByRole("button", { name: "Preview prompt" }).click();
  const prompt = page.getByLabel("Generated prompt");
  await expect(prompt).toContainText("pages/second.astro");
  await expect(prompt).toContainText("```astro");
  await expect(prompt).toContainText("Make this heading clearer.");
  expect(errors).toEqual([]);
});

test("updates original coordinates after HMR without duplicating the runtime", async ({
  page,
}, testInfo) => {
  const fixtures: Record<string, string> = {
    astro5: "compat-astro5/.fixture",
    astro6: "compat-astro6/.fixture",
    astro7: "compat-astro7/src",
  };
  const fixture = fixtures[testInfo.project.name];
  if (fixture === undefined) throw new Error("Unknown Astro fixture.");
  const file = fileURLToPath(
    new URL(`../../playgrounds/${fixture}/components/Card.astro`, import.meta.url),
  );
  const original = await readFile(file, "utf8");
  await page.goto("/models/");
  const marker = await page.locator("#counter").getAttribute("data-spotpatch-source");
  expect(marker).toMatch(/:7:3:astro$/u);
  try {
    // Keep frontmatter at the beginning while moving original template lines.
    await writeFile(file, original.replace("<section", "\n<section"));
    await expect(page.locator("#counter")).toHaveAttribute(
      "data-spotpatch-source",
      marker?.replace(":7:3:", ":8:3:") ?? "",
    );
    await expect(
      page.getByRole("button", { name: "选择元素", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "选择元素", exact: true }).click();
    await page.locator("#counter").click();
    await expect(page.locator(".spotpatch-summary")).toContainText(
      "components/Card.astro:8:3",
    );
  } finally {
    await writeFile(file, original);
  }
});
