/**
 * Narrowing helpers for JSON PromptLens doesn't control: LLM output, GitHub API responses,
 * Claude Code session logs, and notes pushed by other people. Everything enters as `unknown`
 * and is read through these, so a wrong shape degrades to a default instead of a crash.
 */

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as an object, or an empty object when it is anything else. */
export function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

/** The value as an array, or an empty array when it is anything else. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Only the string elements of an array; anything else yields []. */
export function asStrings(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}

/** Parse JSON text that must be an object at the top level. */
export function parseObject(text: string): JsonObject {
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error("expected a JSON object");
  return value;
}
