import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@spotpatch/shared";

import { parseUnifiedPatch } from "./patch-parser.js";

const validPatch = `diff --git a/src/App.tsx b/src/App.tsx
index 1111111..2222222 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-export const value = "before";
+export const value = "after";
diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1 @@
+export const created = true;
`;

describe("unified patch parser", () => {
  it("extracts allowed modified and added files", () => {
    expect(parseUnifiedPatch(validPatch)).toEqual([
      { relativePath: "src/App.tsx", kind: "modified" },
      { relativePath: "src/new-file.ts", kind: "added" },
    ]);
  });

  it.each([
    validPatch.replaceAll("src/App.tsx", "../outside.ts"),
    validPatch.replaceAll("src/App.tsx", ".env.local"),
  ])("denies unsafe paths", (patch) => {
    expect(() => parseUnifiedPatch(patch)).toThrowError(ERROR_CODES.TOOL_DENIED);
  });

  it.each([
    validPatch.replace("new file mode 100644", "new file mode 100755"),
    `${validPatch}GIT binary patch\n`,
    validPatch.replace("+++ b/src/App.tsx", "+++ b/src/Other.tsx"),
    `${validPatch}${validPatch}`,
    "not a patch",
  ])("rejects malformed patches", (patch) => {
    expect(() => parseUnifiedPatch(patch)).toThrowError(ERROR_CODES.PATCH_REJECTED);
  });
});
