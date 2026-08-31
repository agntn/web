import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { createSourceBuildId } from "./build-id.ts";

declare const __AGNTN_WEB_BUILD_ID__: string;

/** The package build and process instance currently serving requests. */
export interface RuntimeInfo {
  readonly version: string;
  readonly buildId: string;
  readonly processStartedAt: string;
}

export const version: string = pkg.version;
const buildId =
  typeof __AGNTN_WEB_BUILD_ID__ === "undefined"
    ? createSourceBuildId(fileURLToPath(new URL("../", import.meta.url)))
    : __AGNTN_WEB_BUILD_ID__;
const processStartedAt = new Date(performance.timeOrigin).toISOString();
/** Immutable identity of the loaded package and hosting process. */
export const runtimeInfo: RuntimeInfo = Object.freeze({ version, buildId, processStartedAt });
