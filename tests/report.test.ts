import { describe, expect, it } from "vitest";
import { synthesisFromModel } from "../src/openai.js";
import { parseContext, renderReport, REPORT_MARKER, templateSynthesis, type CommitEntry } from "../src/report.js";
import { contextFromModel, extractJson, heuristicContext } from "../src/summarize.js";
import type { RawCapture } from "../src/types.js";

const raw: RawCapture = {
  version: 1,
  sha: "1111111aaaaaaa",
  subject: "feat: rate limit login",
  window: { from: null, to: "2026-11-09T01:00:00Z" },
  filesChanged: ["src/login.ts", "README.md"],
  sessions: [
    {
      sessionId: "s1",
      agent: "claude-code",
      prompts: [
        { ts: "t1", text: "Add rate limiting to login. My key is sk-proj-abcdefghijklmnopqrstuvwxyz123456" },
        { ts: "t2", text: "Use a per-user bucket instead" },
      ],
      edits: [{ ts: "t3", tool: "Edit", file: "src/login.ts" }],
      commands: [
        { ts: "t4", command: "npx vitest run", description: "Run tests" },
        { ts: "t5", command: "ls" },
      ],
      decisions: [{ ts: "t6", question: "Per IP or per user?", answer: "Per user" }],
      assistantNotes: ["Using a token bucket."],
    },
  ],
};

describe("heuristicContext", () => {
  const ctx = heuristicContext(raw);
  it("redacts prompts and detects verification commands", () => {
    expect(ctx.keyPrompts[0].text).toContain("[REDACTED:openai-key]");
    expect(ctx.verification).toHaveLength(1);
    expect(ctx.verification[0].text).toContain("Run tests");
  });
  it("flags AI-edited files and counts stats", () => {
    expect(ctx.files).toEqual([
      { path: "src/login.ts", aiEdited: true },
      { path: "README.md", aiEdited: false },
    ]);
    expect(ctx.stats).toEqual({ sessions: 1, prompts: 2, aiEdits: 1 });
    expect(ctx.decisions[0].text).toBe("Per IP or per user? → Per user");
  });
});

describe("contextFromModel", () => {
  it("quotes prompts from the capture by index, never from the model", () => {
    const ctx = contextFromModel(raw, {
      intent: { text: "Protect login from brute force", inferred: false },
      keyPrompts: [{ index: 1, why: "Changed the design" }, { index: 99, why: "bogus" }],
      decisions: [{ text: "Per-user buckets", inferred: true }],
      aiWork: ["Added middleware"],
      verification: [],
    });
    expect(ctx.keyPrompts).toEqual([{ text: "Use a per-user bucket instead", why: "Changed the design" }]);
    expect(ctx.decisions[0].inferred).toBe(true);
    expect(ctx.generatedBy).toBe("claude-cli");
  });

  it("falls back per-field when the model output is malformed", () => {
    const ctx = contextFromModel(raw, {});
    expect(ctx.intent.text).toContain("Add rate limiting");
    expect(ctx.keyPrompts.length).toBeGreaterThan(0);
  });

  it("extracts JSON wrapped in prose or code fences", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("nothing")).toThrow();
  });
});

describe("renderReport", () => {
  const entries: CommitEntry[] = [
    { sha: raw.sha, subject: raw.subject, context: heuristicContext(raw) },
    { sha: "2222222bbbbbbb", subject: "chore: bump deps", context: null },
  ];

  it("renders one marked comment with stats, decisions and a commit timeline", () => {
    const md = renderReport(entries, templateSynthesis(entries), { now: new Date("2026-11-09T00:00:00Z") });
    expect(md.startsWith(REPORT_MARKER)).toBe(true);
    expect(md).toContain("| 2 | 1 / 2 | 1 | 2 | 1 / 2 |");
    expect(md).toContain("Per IP or per user? → Per user");
    expect(md).toContain("<code>2222222</code> chore: bump deps — <i>no AI context</i>");
    expect(md).toContain("has no AI context");
    expect(md).not.toContain("sk-proj-");
  });

  it("escapes HTML in prompts so they cannot break the comment layout", () => {
    const ctx = heuristicContext({ ...raw, sessions: [{ ...raw.sessions[0], prompts: [{ ts: "t", text: "</details><!-- x -->" }] }] });
    const md = renderReport([{ sha: raw.sha, subject: "x", context: ctx }], templateSynthesis([]));
    expect(md).toContain("&lt;/details&gt;");
  });

  it("merges an LLM synthesis while keeping missing-context warnings", () => {
    const syn = synthesisFromModel(
      { overview: "Adds login rate limiting.", why: ["brute force"], keyDecisions: [{ text: "per user" }], reviewFocus: [{ file: "src/login.ts", text: "bucket math" }] },
      "OpenAI test",
      templateSynthesis(entries),
    );
    const md = renderReport(entries, syn);
    expect(md).toContain("> Adds login rate limiting.");
    expect(md).toContain("`src/login.ts` — bucket math");
    expect(md).toContain("has no AI context");
    expect(md).toContain("Synthesis: OpenAI test");
  });
});

describe("parseContext", () => {
  it("rejects garbage notes", () => {
    expect(parseContext(null)).toBeNull();
    expect(parseContext("not json")).toBeNull();
    expect(parseContext('{"version":2}')).toBeNull();
  });
});
