import { expect, test } from "@playwright/test";

test("maps an AntD host button to its business request and runtime dispatch", async ({
  page,
}) => {
  await page.route("**/api/e2e/users**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { list: [{ id: 1 }, { id: 2 }] } }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByTestId("data-flow-button").click();
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Data flow" }).click();
  const componentPanel = dialog.locator(".spotpatch-data-flow-panel:not([hidden])");

  await expect(componentPanel.locator(".spotpatch-data-flow-endpoint")).toContainText(
    "GET/api/e2e/users",
  );
  await expect(componentPanel.locator(".spotpatch-data-flow-card-body")).toContainText(
    "query.token",
  );
  await expect(componentPanel.locator(".spotpatch-data-flow-card-body")).toContainText(
    "react-state:rows",
  );
  await expect(dialog).not.toContainText("never-display-token");

  await dialog.getByRole("button", { name: "Close SpotPatch" }).click();
  await page.getByTestId("data-flow-button").click();
  await expect(page.getByTestId("data-flow-count")).toHaveText("2");
  await page.getByRole("button", { name: "Select element" }).click();
  await dialog.getByRole("tab", { name: "Data flow" }).click();
  await dialog.getByRole("button", { name: /Refresh evidence/u }).click();
  await expect(
    componentPanel.locator(".spotpatch-data-flow-badge").first(),
  ).toContainText("Actually requested in this session");
  await expect(componentPanel.locator(".spotpatch-data-flow-endpoint code")).toHaveText(
    `${new URL(page.url()).origin}/api/e2e/users`,
  );
  await expect(componentPanel.locator(".spotpatch-data-flow-card-body")).toContainText(
    "1 static · 1 runtime",
  );

  await dialog.getByRole("tab", { name: "Page APIs" }).click();
  await expect(dialog).not.toContainText("/__spotpatch/");
});
