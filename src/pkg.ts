import { readFileSync } from "node:fs";

export interface PackageInfo {
  name: string;
  version: string;
}

function isPackageInfo(value: unknown): value is PackageInfo {
  if (typeof value !== "object" || value === null) return false;
  const { name, version } = value as Record<string, unknown>;
  return typeof name === "string" && typeof version === "string";
}

/** Parse package.json text, failing loudly instead of trusting its shape. */
export function parsePackageInfo(text: string): PackageInfo {
  const value: unknown = JSON.parse(text);
  if (!isPackageInfo(value)) throw new Error("package.json is missing a string name or version");
  return { name: value.name, version: value.version };
}

/**
 * The installed package's own name and version. Both `src/` (tests) and `dist/` (published build)
 * sit one level below package.json, so the same relative URL works for each.
 */
export const pkg: PackageInfo = parsePackageInfo(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
