import { expect, test } from "@playwright/test";

test("selects a native element and sends an authorized editor request", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  let editorRequestBody: unknown;
  let editorToken = "";

  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });
  await page.route("**/__spotpatch/v1/open-editor", async (route) => {
    editorRequestBody = route.request().postDataJSON() as unknown;
    editorToken = route.request().headers()["x-spotpatch-token"] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Select element" }).click();
  await expect(page.getByRole("button", { name: "Stop selecting" })).toBeVisible();

  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();

  const dialog = page.getByRole("dialog", { name: "Selected element" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".spotpatch-summary")).toContainText(
    /src\/main\.tsx:\d+:\d+/,
  );

  await dialog.getByRole("button", { name: "Open in VS Code" }).click();
  await expect.poll(() => editorRequestBody).toBeDefined();

  expect(editorRequestBody).toEqual({
    fileId: expect.any(String),
    line: expect.any(Number),
    column: expect.any(Number),
  });
  expect(editorToken.length).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Select element" })).toBeVisible();
});
