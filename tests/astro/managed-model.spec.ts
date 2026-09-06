import { expect, test } from "@playwright/test";
import type { ExternalAgentControlStatus } from "@spotpatch/shared";

test("managed model picker applies a server catalog choice without publishing work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let status: ExternalAgentControlStatus = {
    schemaVersion: 1,
    sequence: 1,
    mode: "managed",
    adapter: { kind: "codex", maturity: "experimental", availability: "available" },
    connectionState: "ready",
    authReadiness: "authenticated",
    grantState: "valid",
    requestedModel: "fixture-default",
    effectiveModel: "fixture-default",
    models: ["fixture-default", "fixture-alternative"],
    updatedAt: new Date().toISOString(),
  };
  const requests: unknown[] = [];
  await page.route("**/external-agent/control/status", (route) =>
    route.fulfill({ json: { ok: true, data: status } }),
  );
  await page.route("**/external-agent/events", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({ type: "status", data: status })}\n`,
    }),
  );
  await page.route("**/external-agent/control/connect", async (route) => {
    const body: unknown = route.request().postDataJSON();
    requests.push(body);
    expect(body).toMatchObject({
      adapterKind: "codex",
      profile: "managed-apply-v1",
      model: "fixture-alternative",
    });
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      "adapterKind",
      "model",
      "profile",
      "requestId",
    ]);
    status = {
      ...status,
      sequence: 2,
      requestedModel: "fixture-alternative",
      effectiveModel: "fixture-alternative",
    };
    await route.fulfill({ json: { ok: true, data: status } });
  });
  await page.goto("/models/features");
  await page.getByRole("button", { name: "Select element", exact: true }).click();
  await page.locator("#native-load").click();
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await dialog
    .locator("textarea[data-target-instruction-id]")
    .fill("Fixture only; do not publish this request.");
  const model = dialog.getByRole("combobox", {
    name: "Managed Codex model",
    exact: true,
  });
  await expect(model).toBeVisible();
  await expect(model).toHaveValue("fixture-default");
  await model.selectOption("fixture-alternative");
  await expect(
    dialog.getByRole("button", { name: "Publish to Agent inbox" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Apply model", exact: true }).click();
  await expect(model).toHaveValue("fixture-alternative");
  await expect(
    dialog.getByRole("button", { name: "Connect Codex", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Publish to Agent inbox" }),
  ).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});
