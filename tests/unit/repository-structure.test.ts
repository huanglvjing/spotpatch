import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const REPOSITORY_URL = "git+https://github.com/huanglvjing/spotpatch.git";
const HOMEPAGE_URL = "https://github.com/huanglvjing/spotpatch#readme";
const BUGS_URL = "https://github.com/huanglvjing/spotpatch/issues";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
const NPM_README_ICON_PATH = "docs/assets/spotpatch-npm-icon.png";
const NPM_README_ICON_URL =
  "https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png";

const workspacePackages = [
  { directory: "packages/astro", name: "@spotpatch/astro" },
  { directory: "packages/shared", name: "@spotpatch/shared" },
  { directory: "packages/bridge", name: "@spotpatch/bridge" },
  { directory: "packages/compiler", name: "@spotpatch/compiler" },
  { directory: "packages/analyzer", name: "@spotpatch/analyzer" },
  { directory: "packages/agent", name: "@spotpatch/agent" },
  { directory: "packages/dev-server", name: "@spotpatch/dev-server" },
  {
    directory: "packages/react-adapter",
    name: "@spotpatch/react-adapter",
  },
  { directory: "packages/runtime", name: "@spotpatch/runtime" },
  { directory: "packages/next", name: "@spotpatch/next" },
  { directory: "packages/vite", name: "@spotpatch/vite" },
] as const;

interface PackageManifest {
  readonly bin?: Readonly<Record<string, string>>;
  readonly bugs?: { readonly url?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly homepage?: string;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: {
    readonly access?: string;
    readonly registry?: string;
  };
  readonly repository?: {
    readonly directory?: string;
    readonly type?: string;
    readonly url?: string;
  };
  readonly version?: string;
}

async function readManifest(directory: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(`${directory}/package.json`, "utf8"),
  ) as PackageManifest;
}

async function readPendingChangesetPackageNames(): Promise<ReadonlySet<string>> {
  const fileNames = await readdir(".changeset");
  const changesetFiles = fileNames.filter(
    (fileName) => fileName.endsWith(".md") && fileName !== "README.md",
  );
  const contents = await Promise.all(
    changesetFiles.map((fileName) => readFile(`.changeset/${fileName}`, "utf8")),
  );

  return new Set(
    contents.flatMap((content) => {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content)?.[1] ?? "";
      return [
        ...frontmatter.matchAll(/^"([^"]+)":\s+(?:major|minor|patch)$/gmu),
      ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    }),
  );
}

describe("repository structure", () => {
  it("declares the public packages required by the architecture", async () => {
    const manifests = await Promise.all(
      workspacePackages.map(({ directory }) => readManifest(directory)),
    );

    expect(manifests.map(({ name }) => name)).toEqual(
      workspacePackages.map(({ name }) => name),
    );
  });

  it("publishes every package with traceable npm metadata and documentation", async () => {
    await Promise.all(
      workspacePackages.map(async ({ directory, name }) => {
        const [manifest, readme] = await Promise.all([
          readManifest(directory),
          readFile(`${directory}/README.md`, "utf8"),
        ]);

        expect(manifest).toMatchObject({
          bugs: { url: BUGS_URL },
          homepage: HOMEPAGE_URL,
          name,
          publishConfig: {
            access: "public",
            registry: NPM_REGISTRY_URL,
          },
          repository: {
            directory,
            type: "git",
            url: REPOSITORY_URL,
          },
        });
        expect(readme.trim()).not.toBe("");
        const expectedHeading = `<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="${NPM_README_ICON_URL}" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>${name}</code></h1>`;
        expect(readme.startsWith(expectedHeading)).toBe(true);
        expect(readme).not.toContain("spotpatch-logo-mark.svg");
      }),
    );
  });

  it("publishes the supported Vite setup command", async () => {
    const manifest = await readManifest("packages/vite");

    expect(manifest.bin).toEqual({
      "spotpatch-vite": "./dist/cli.js",
    });
  });

  it("keeps the npm README icon compact and retina-ready", async () => {
    const icon = await readFile(NPM_README_ICON_PATH);

    expect(icon.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(icon.readUInt32BE(16)).toBe(64);
    expect(icon.readUInt32BE(20)).toBe(64);
  });

  it("resolves every workspace dependency to a declared public package", async () => {
    const manifests = await Promise.all(
      workspacePackages.map(({ directory }) => readManifest(directory)),
    );
    const workspaceNames = new Set(workspacePackages.map(({ name }) => name));

    for (const manifest of manifests) {
      const dependencyGroups = [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ];

      for (const dependencies of dependencyGroups) {
        for (const [dependencyName, range] of Object.entries(dependencies ?? {})) {
          if (!range.startsWith("workspace:")) {
            continue;
          }

          expect(
            workspaceNames,
            `${manifest.name ?? "<unnamed>"} -> ${dependencyName}`,
          ).toContain(dependencyName);
        }
      }
    }
  });

  it("includes every unpublished package in an initial release changeset", async () => {
    const [manifests, pendingPackageNames] = await Promise.all([
      Promise.all(workspacePackages.map(({ directory }) => readManifest(directory))),
      readPendingChangesetPackageNames(),
    ]);

    for (const manifest of manifests) {
      if (manifest.version === "0.0.0") {
        expect(pendingPackageNames, manifest.name).toContain(manifest.name);
      }
    }
  });
});
