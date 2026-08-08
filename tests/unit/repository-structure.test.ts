import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const REPOSITORY_URL = "git+https://github.com/huanglvjing/spotpatch.git";
const HOMEPAGE_URL = "https://github.com/huanglvjing/spotpatch#readme";
const BUGS_URL = "https://github.com/huanglvjing/spotpatch/issues";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/";

const workspacePackages = [
  { directory: "packages/shared", name: "@spotpatch/shared" },
  { directory: "packages/agent", name: "@spotpatch/agent" },
  {
    directory: "packages/react-adapter",
    name: "@spotpatch/react-adapter",
  },
  { directory: "packages/runtime", name: "@spotpatch/runtime" },
  { directory: "packages/vite", name: "@spotpatch/vite" },
] as const;

interface PackageManifest {
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
      }),
    );
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
