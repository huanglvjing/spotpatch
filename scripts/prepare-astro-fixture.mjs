import { cp, rm } from "node:fs/promises";
import path from "node:path";

// Keep one authored fixture while testing each framework with its own dependency
// graph and a source directory inside its project security boundary.
const destination = path.join(process.cwd(), ".fixture");
await rm(destination, { recursive: true, force: true });
await cp(new URL("../playgrounds/compat-astro7/src/", import.meta.url), destination, {
  recursive: true,
});
