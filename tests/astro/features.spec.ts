import { expect, test } from "@playwright/test";

test("native scripts and hydrated React islands expose real data-flow evidence", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/models/features");
  await page.locator("#native-load").click();
  await expect(page.locator("#native-load")).toHaveText("Native 1");
  await page.locator("#island").click();
  await expect(page.locator("#island")).toHaveText("Island 1");
  await expect(page.locator("#island")).toHaveAttribute(
    "data-spotpatch-source",
    /^[\w-]+:\d+:\d+$/u,
  );
  await page.getByRole("button", { name: "Select element", exact: true }).click();
  await page.locator("#native-load").click();
  await expect(page.locator(".spotpatch-summary")).toContainText(
    "pages/features.astro",
  );
  await page.getByRole("tab", { name: "Page APIs", exact: true }).click();
  const pagePanel = page.getByRole("tabpanel", { name: "Page APIs", exact: true });
  const panel = pagePanel
    .locator(".spotpatch-data-flow-card")
    .filter({ hasText: "/models/api/data.json" });
  await expect(pagePanel).toBeVisible();
  await expect(panel.first()).toBeVisible();
  const observations: unknown = await page.evaluate(() => {
    const runtime: unknown = Reflect.get(
      globalThis,
      Symbol.for("spotpatch.data-flow.runtime.v1"),
    );
    if (
      typeof runtime !== "object" ||
      runtime === null ||
      !("observations" in runtime) ||
      typeof runtime.observations !== "function"
    )
      throw new Error("Data-flow runtime missing");
    return Reflect.apply(runtime.observations, runtime, []) as unknown;
  });
  await testInfo.attach("native-observations", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
  await expect(panel.first()).toContainText("Actually requested");
  await expect(panel.first()).toContainText("Browser");
  await expect(panel.first()).not.toContainText("private");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Select element", exact: true }).click();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.locator("#island").click();
  await expect(page.locator(".spotpatch-summary")).toContainText(
    "components/Island.tsx",
  );
  await page.getByRole("tab", { name: "Page APIs", exact: true }).click();
  await expect(panel.first()).toContainText("Actually requested");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.locator("#second")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select element", exact: true }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Ask and external Agent capabilities reach the shared Astro backend", async ({
  page,
}) => {
  const askResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/ask/capability"),
  );
  const externalResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/external-handoff/capability"),
  );
  await page.goto("/models/features");
  await page.getByRole("button", { name: "Select element", exact: true }).click();
  await page.locator("#native-load").click();
  const dialog = page.locator("spotpatch-root").getByRole("dialog");
  await dialog.getByRole("tab", { name: "Ask", exact: true }).click();
  const response = await askResponse;
  expect(response.status()).toBe(200);
  const capability: unknown = await response.json();
  expect(capability).toMatchObject({
    ok: true,
    data: { enabled: true, safety: { writesAllowed: false, selectionRequired: true } },
  });
  await expect(
    dialog.getByRole("combobox", { name: "Read-only executor", exact: true }),
  ).toBeVisible();
  const external = await externalResponse;
  expect(external.status()).toBe(200);
  const handoff: unknown = await external.json();
  expect(handoff).toMatchObject({
    ok: true,
    data: { enabled: true, brokerReady: true },
  });
});
