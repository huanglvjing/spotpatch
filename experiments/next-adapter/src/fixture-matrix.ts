import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FixtureDefinition } from "./contracts.js";

export const experimentRoot = fileURLToPath(new URL("../", import.meta.url));
export const repositoryRoot = path.resolve(experimentRoot, "../..");

const fixturesRoot = path.join(experimentRoot, "fixtures");

export const fixtureMatrix = Object.freeze([
  {
    id: "next15-react18",
    directory: path.join(fixturesRoot, "next15-react18"),
    nextVersion: "15.3.9",
    reactVersion: "18.3.1",
    development: [
      { bundler: "webpack", args: ["dev"] },
      { bundler: "turbopack", args: ["dev", "--turbopack"] },
    ],
    production: { bundler: "webpack", args: ["build"] },
  },
  {
    id: "next16-react19",
    directory: path.join(fixturesRoot, "next16-react19"),
    nextVersion: "16.3.0",
    reactVersion: "19.2.8",
    development: [
      { bundler: "turbopack", args: ["dev"] },
      { bundler: "webpack", args: ["dev", "--webpack"] },
    ],
    production: { bundler: "turbopack", args: ["build"] },
  },
] satisfies readonly FixtureDefinition[]);
