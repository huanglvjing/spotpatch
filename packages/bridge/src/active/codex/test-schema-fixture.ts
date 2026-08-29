import { REQUIRED_CODEX_SCHEMA_METHODS } from "./executable.js";

export function fakeSchemaCommandSource(
  omitMethod?: string,
  schemaRootSymlinkTarget?: string,
): string {
  const schemas = Object.fromEntries(
    Object.entries(REQUIRED_CODEX_SCHEMA_METHODS).map(([fileName, methods]) => [
      fileName,
      {
        oneOf: methods
          .filter((method) => method !== omitMethod)
          .map((method) => ({ properties: { method: { enum: [method] } } })),
      },
    ]),
  );

  return String.raw`
if (process.argv[2] === "app-server" && process.argv[3] === "generate-json-schema") {
  const args = process.argv.slice(2);
  if (
    args.length !== 5 ||
    args[2] !== "--experimental" ||
    args[3] !== "--out" ||
    !path.isAbsolute(args[4])
  ) process.exit(65);
  const schemaRootSymlinkTarget = ${JSON.stringify(schemaRootSymlinkTarget)};
  if (schemaRootSymlinkTarget === undefined) {
    fs.mkdirSync(args[4], { recursive: true });
  } else {
    fs.mkdirSync(schemaRootSymlinkTarget, { recursive: true });
    fs.symlinkSync(schemaRootSymlinkTarget, args[4], "dir");
  }
  const schemas = ${JSON.stringify(schemas)};
  for (const [fileName, schema] of Object.entries(schemas)) {
    fs.writeFileSync(path.join(args[4], fileName), JSON.stringify(schema));
  }
  process.exit(0);
}
`;
}
