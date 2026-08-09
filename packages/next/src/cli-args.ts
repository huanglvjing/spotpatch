import { isLoopbackHostname } from "@spotpatch/dev-server";
import type { SpotPatchNextBundler } from "@spotpatch/shared";

export interface NextDevArguments {
  readonly bundler: SpotPatchNextBundler;
  readonly hostname: string;
  readonly nextArguments: readonly string[];
  readonly port: number;
  readonly publicOrigin: string;
}

function parsePort(value: string): number {
  const port = Number(value);

  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new RangeError("SpotPatch Next requires a valid development port.");
  }

  return port;
}

function parseOptionValue(
  arguments_: readonly string[],
  index: number,
  longName: string,
  shortName: string,
): Readonly<{ consumed: number; value?: string }> {
  const argument = arguments_[index];

  if (argument === longName || argument === shortName) {
    const value = arguments_[index + 1];

    if (value === undefined || value.startsWith("-")) {
      throw new Error(`SpotPatch Next requires a value after ${argument}.`);
    }

    return Object.freeze({ consumed: 1, value });
  }

  const longPrefix = `${longName}=`;
  const shortPrefix = `${shortName}=`;

  if (argument?.startsWith(longPrefix)) {
    return Object.freeze({ consumed: 0, value: argument.slice(longPrefix.length) });
  }

  if (argument?.startsWith(shortPrefix)) {
    return Object.freeze({ consumed: 0, value: argument.slice(shortPrefix.length) });
  }

  return Object.freeze({ consumed: 0 });
}

export function parseNextDevArguments(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  defaultBundler: SpotPatchNextBundler = "turbopack",
): NextDevArguments {
  let hostname: string | undefined;
  let port: number | undefined;
  let webpack = false;
  let turbopack = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const hostOption = parseOptionValue(arguments_, index, "--hostname", "-H");

    if (hostOption.value !== undefined) {
      if (hostname !== undefined) {
        throw new Error("SpotPatch Next received duplicate hostname options.");
      }

      hostname = hostOption.value;
      index += hostOption.consumed;
      continue;
    }

    const portOption = parseOptionValue(arguments_, index, "--port", "-p");

    if (portOption.value !== undefined) {
      if (port !== undefined) {
        throw new Error("SpotPatch Next received duplicate port options.");
      }

      port = parsePort(portOption.value);
      index += portOption.consumed;
      continue;
    }

    if (argument === "--webpack") {
      webpack = true;
    } else if (argument === "--turbopack" || argument === "--turbo") {
      turbopack = true;
    }
  }

  const resolvedHostname = hostname ?? "localhost";

  if (!isLoopbackHostname(resolvedHostname)) {
    throw new Error(
      "SpotPatch Next only supports a loopback --hostname in its first release.",
    );
  }

  if (webpack && turbopack) {
    throw new Error("SpotPatch Next cannot enable webpack and Turbopack together.");
  }

  const resolvedPort =
    port ?? (environment.PORT === undefined ? 3_000 : parsePort(environment.PORT));
  const hostForUrl = resolvedHostname.includes(":")
    ? `[${resolvedHostname}]`
    : resolvedHostname;
  const nextArguments = [...arguments_];

  if (hostname === undefined) {
    nextArguments.push("--hostname", resolvedHostname);
  }

  if (port === undefined) {
    nextArguments.push("--port", String(resolvedPort));
  }

  return Object.freeze({
    bundler: webpack ? "webpack" : turbopack ? "turbopack" : defaultBundler,
    hostname: resolvedHostname,
    nextArguments: Object.freeze(nextArguments),
    port: resolvedPort,
    publicOrigin: `http://${hostForUrl}:${String(resolvedPort)}`,
  });
}
