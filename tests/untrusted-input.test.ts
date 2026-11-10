import { describe, expect, it } from "vitest";
import { readPullRequestEvent } from "../src/github.js";
import { asArray, asObject, asStrings, parseObject } from "../src/json.js";
import { synthesisFromModel } from "../src/openai.js";
import { parseContext, templateSynthesis } from "../src/report.js";
import { parseSessionLog } from "../src/sessions.js";
import { claudeResult, contextFromModel, heuristicContext } from "../src/summarize.js";
import { parseTurnGroups } from "../src/turns.js";
import type { RawCapture } from "../src/types.js";
import { isCommitContext, isRawCapture } from "../src/validate.js";

const raw: RawCapture = {
  version: 1,
  sha: "2222222bbbbbbb",
  subject: "fix: handle empty cart",
  window: { from: "2026-11-09T00:00:00Z", to: "2026-11-09T01:00:00Z" },
  filesChanged: ["src/cart.ts"],
  sessions: [
    {
      sessionId: "s1",
      agent: "claude-code",
      prompts: [{ ts: "2026-11-09T00:10:00Z", text: "Handle an empty cart without throwing" }],
      edits: [{ ts: "2026-11-09T00:11:00Z", tool: "Edit", file: "src/cart.ts" }],
      commands: [{ ts: "2026-11-09T00:12:00Z", command: "npm test" }],
      decisions: [],
      assistantNotes: [],
    },
  ],
};

describe("json helpers", () => {
  it("degrade wrong shapes to empty defaults", () => {
    expect(asObject(null)).toEqual({});
    expect(asObject([1])).toEqual({});
    expect(asArray("x")).toEqual([]);
    expect(asStrings(["a", 1, null, "b"])).toEqual(["a", "b"]);
  });

  it("parseObject rejects JSON that is not an object", () => {
    expect(parseObject('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseObject("[1,2]")).toThrow("expected a JSON object");
    expect(() => parseObject("null")).toThrow();
  });
});

describe("model output with the wrong shape", () => {
  it("contextFromModel falls back field by field instead of throwing", () => {
    const ctx = contextFromModel(raw, {
      intent: { text: 42 },
      keyPrompts: "not an array",
      decisions: [{ text: null }, "junk", { text: "Return [] for an empty cart", inferred: "yes" }],
      aiWork: [1, "Guarded the reducer", { x: 1 }],
      verification: null,
      turns: [{ prompts: ["0"], title: 7, steps: [{ type: "fix", text: 3 }], tips: { keep: [1, "Clear ask"] } }],
    });
    const fallback = heuristicContext(raw);
    expect(ctx.intent).toEqual(fallback.intent);
    expect(ctx.keyPrompts).toEqual(fallback.keyPrompts);
    expect(ctx.decisions).toEqual([{ text: "Return [] for an empty cart", inferred: true }]);
    expect(ctx.aiWork).toEqual(["Guarded the reducer"]);
    expect(ctx.verification).toEqual([]);
    expect(ctx.turns?.[0]?.tips.keep).toEqual(["Clear ask"]);
    expect(isCommitContext(ctx)).toBe(true);
  });

  it("contextFromModel accepts a non-object response", () => {
    expect(contextFromModel(raw, "oops").intent).toEqual(heuristicContext(raw).intent);
    expect(contextFromModel(raw, null).keyPrompts).toEqual(heuristicContext(raw).keyPrompts);
  });

  it("parseTurnGroups keeps only well-typed fields", () => {
    expect(parseTurnGroups([{ prompts: [0, "1"], title: 5, decisions: [{ text: "a", why: 2 }] }, "junk"])).toEqual([
      {
        prompts: [0, 1],
        title: undefined,
        steps: [],
        outcome: undefined,
        decisions: [{ text: "a", why: undefined }],
        tips: { keep: [], improve: [] },
      },
      { prompts: [], title: undefined, steps: [], outcome: undefined, decisions: [], tips: { keep: [], improve: [] } },
    ]);
    expect(parseTurnGroups({ prompts: [0] })).toEqual([]);
  });

  it("synthesisFromModel ignores malformed entries", () => {
    const fallback = templateSynthesis([]);
    const syn = synthesisFromModel(
      {
        overview: "",
        keyDecisions: [null, { text: "Keep one comment" }],
        reviewFocus: "x",
        requests: [{ index: "1", outcome: "Done" }, { index: 99 }],
      },
      "test",
      fallback,
    );
    expect(syn.overview).toBe(fallback.overview);
    expect(syn.keyDecisions).toEqual([{ text: "Keep one comment", inferred: false }]);
    expect(syn.reviewFocus).toEqual([]);
    expect(syn.turnOutcomes).toEqual([undefined, "Done"]);
    expect(synthesisFromModel(undefined, "test", fallback).why).toEqual([]);
  });
});

describe("claudeResult", () => {
  it("returns the result of a JSON envelope", () => {
    expect(claudeResult(0, '{"result":"{\\"a\\":1}"}', "")).toBe('{"a":1}');
  });

  it("reports non-JSON output as an error even when the exit code is 0", () => {
    expect(() => claudeResult(0, "Please log in again", "")).toThrow("without a JSON result: Please log in again");
    expect(() => claudeResult(1, "", "boom")).toThrow("claude -p exited 1 without a JSON result: boom");
  });

  it("surfaces is_error envelopes", () => {
    expect(() => claudeResult(0, '{"is_error":true,"result":"OAuth token expired"}', "")).toThrow("OAuth token expired");
  });
});

describe("notes and captures read back from git", () => {
  it("accepts a context PromptLens wrote and a well-formed capture", () => {
    expect(isCommitContext(heuristicContext(raw))).toBe(true);
    expect(isRawCapture(raw)).toBe(true);
  });

  it("parseContext ignores notes with the wrong shape", () => {
    const good = heuristicContext(raw);
    expect(parseContext(JSON.stringify(good))).toEqual(good);
    expect(parseContext(JSON.stringify({ ...good, keyPrompts: "x" }))).toBeNull();
    expect(parseContext(JSON.stringify({ ...good, files: [{ path: 1, aiEdited: true }] }))).toBeNull();
    expect(parseContext(JSON.stringify({ ...good, generatedBy: "someone" }))).toBeNull();
    expect(parseContext(JSON.stringify({ ...good, turns: [{ key: "k" }] }))).toBeNull();
    expect(parseContext(JSON.stringify({ ...good, version: 2 }))).toBeNull();
    expect(parseContext("[]")).toBeNull();
  });

  it("isRawCapture rejects a capture from another version or a partial write", () => {
    expect(isRawCapture({ ...raw, version: 2 })).toBe(false);
    expect(isRawCapture({ ...raw, sessions: [{ sessionId: "s1" }] })).toBe(false);
    expect(isRawCapture({ ...raw, window: { from: 1, to: "t" } })).toBe(false);
  });
});

describe("parseSessionLog with unexpected blocks", () => {
  it("skips non-object content blocks and tool calls without a name", () => {
    const line = (content: unknown) =>
      JSON.stringify({ type: "assistant", sessionId: "s1", timestamp: "t", cwd: "/w", message: { role: "assistant", content } });
    const log = [
      line(["text", null, 3]),
      line([{ type: "tool_use", input: { file_path: "/w/a.ts" } }]),
      line([{ type: "tool_use", name: "Bash", input: { command: "npm test", description: 7 } }]),
      JSON.stringify(["not", "an", "event"]),
    ].join("\n");
    expect(parseSessionLog(log)).toEqual([
      { kind: "command", ts: "t", sessionId: "s1", cwd: "/w", command: "npm test", description: undefined },
    ]);
  });
});

describe("readPullRequestEvent", () => {
  it("reads the fields the report needs", () => {
    const event = {
      pull_request: {
        number: 7,
        base: { sha: "aaa" },
        head: { sha: "bbb", ref: "feat/x", repo: { full_name: "me/repo" } },
      },
    };
    expect(readPullRequestEvent(event)).toEqual({ number: 7, baseSha: "aaa", headSha: "bbb", headRef: "feat/x", headRepo: "me/repo" });
  });

  it("returns empty fields for other events", () => {
    expect(readPullRequestEvent({ push: {} })).toEqual({});
    expect(readPullRequestEvent(null)).toEqual({});
  });
});
