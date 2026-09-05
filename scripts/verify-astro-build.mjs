import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
assert(root, "Provide a build output directory.");
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(?:html|js|css|json|map|mjs)$/u.test(entry.name)) {
      const content = await readFile(file, "utf8");
      assert(
        !/virtual:spotpatch|__SPOTPATCH_|__spotpatchRuntime__|\/__spotpatch|spotpatch-root|data-spotpatch-source="[A-Za-z0-9_-]+:[1-9]/u.test(
          content,
        ),
        `SpotPatch production residue in ${file}`,
      );
    }
  }
}
await scan(path.resolve(root));
