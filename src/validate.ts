import { isArray, isObject, type JsonObject } from "./json.js";
import type { CommitContext, RawCapture } from "./types.js";

/**
 * Structural checks for JSON PromptLens reads back from disk or from the notes ref.
 * Notes come from `git fetch`, so they may be written by another version or another person:
 * a note that fails these checks is ignored rather than trusted by the renderer.
 */

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const arrayOf = (v: unknown, item: (x: unknown) => boolean): v is unknown[] => isArray(v) && v.every(item);
const has = (o: JsonObject, shape: Record<string, (v: unknown) => boolean>) => Object.entries(shape).every(([k, check]) => check(o[k]));

const isClaim = (v: unknown) => isObject(v) && has(v, { text: isString, inferred: isBoolean });
const isTextWhy = (v: unknown) => isObject(v) && has(v, { text: isString, why: isString });
const isStep = (v: unknown) => isObject(v) && has(v, { type: isString, text: isString });
const isFile = (v: unknown) => isObject(v) && has(v, { path: isString, aiEdited: isBoolean });
const strings = (v: unknown) => arrayOf(v, isString);

const isTurn = (v: unknown) =>
  isObject(v) &&
  has(v, {
    key: isString,
    title: isString,
    prompts: strings,
    carried: isBoolean,
    steps: (s) => arrayOf(s, isStep),
    outcome: isString,
    decisions: (d) => arrayOf(d, isTextWhy),
    tips: (t) => isObject(t) && strings(t.keep) && strings(t.improve),
    metrics: (m) => isObject(m) && has(m, { start: isString, end: isString, aiSteps: isNumber, files: isNumber, reruns: isNumber }),
    sessionId: isString,
  });

export function isCommitContext(v: unknown): v is CommitContext {
  return (
    isObject(v) &&
    v.version === 1 &&
    has(v, {
      sha: isString,
      subject: isString,
      generatedBy: (g) => g === "claude-cli" || g === "openai" || g === "heuristic",
      intent: isClaim,
      keyPrompts: (k) => arrayOf(k, isTextWhy),
      decisions: (d) => arrayOf(d, isClaim),
      aiWork: strings,
      verification: (c) => arrayOf(c, isClaim),
      files: (f) => arrayOf(f, isFile),
      stats: (s) => isObject(s) && has(s, { sessions: isNumber, prompts: isNumber, aiEdits: isNumber }),
      sessionIds: strings,
      turns: (t) => t === undefined || arrayOf(t, isTurn),
    })
  );
}

const isEventBase = (v: unknown): v is JsonObject => isObject(v) && isString(v.ts);

const isSlice = (v: unknown) =>
  isObject(v) &&
  has(v, {
    sessionId: isString,
    agent: (a) => a === "claude-code",
    prompts: (p) => arrayOf(p, (x) => isEventBase(x) && isString(x.text)),
    edits: (e) => arrayOf(e, (x) => isEventBase(x) && isString(x.tool) && isString(x.file)),
    commands: (c) => arrayOf(c, (x) => isEventBase(x) && isString(x.command)),
    decisions: (d) => arrayOf(d, (x) => isEventBase(x) && isString(x.question) && isString(x.answer)),
    assistantNotes: strings,
  });

export function isRawCapture(v: unknown): v is RawCapture {
  return (
    isObject(v) &&
    v.version === 1 &&
    has(v, {
      sha: isString,
      subject: isString,
      window: (w) => isObject(w) && (w.from === null || isString(w.from)) && isString(w.to),
      filesChanged: strings,
      sessions: (s) => arrayOf(s, isSlice),
    })
  );
}
