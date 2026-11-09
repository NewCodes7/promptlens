import { describe, expect, it } from "vitest";
import { collectPhases, mergeToMax, renderFlow, type FlowPhase } from "../src/flow.js";
import { buildTimeline, heuristicPhases, phasesFromModel } from "../src/phases.js";
import { redact, truncate } from "../src/redact.js";
import type { CommitEntry } from "../src/report.js";
import { heuristicContext } from "../src/summarize.js";
import type { RawCapture } from "../src/types.js";

const raw: RawCapture = {
  version: 1,
  sha: "aaaaaaa1111",
  subject: "feat: login limit",
  window: { from: null, to: "2026-11-09T02:00:00Z" },
  filesChanged: ["src/login.ts", "tests/login.test.ts", "README.md"],
  sessions: [
    {
      sessionId: "s1",
      agent: "claude-code",
      prompts: [
        { ts: "2026-11-09T01:00:00Z", text: "Add rate limiting to login" },
        { ts: "2026-11-09T01:30:00Z", text: "Now document it" },
      ],
      decisions: [{ ts: "2026-11-09T01:01:00Z", question: "Per IP or per user?", answer: "Per user" }],
      edits: [
        { ts: "2026-11-09T01:05:00Z", tool: "Edit", file: "src/login.ts" },
        { ts: "2026-11-09T01:06:00Z", tool: "Write", file: "tests/login.test.ts" },
        { ts: "2026-11-09T01:31:00Z", tool: "Edit", file: "README.md" },
      ],
      commands: [{ ts: "2026-11-09T01:10:00Z", command: "npx vitest run", description: "Run tests" }],
      assistantNotes: [],
    },
  ],
};

describe("timeline and phases", () => {
  it("orders steps by time and collapses consecutive edits", () => {
    const tl = buildTimeline(raw);
    expect(tl.map((t) => t.kind)).toEqual(["prompt", "decision", "edit", "command", "prompt", "edit"]);
    expect(tl[2].files).toEqual(["src/login.ts", "tests/login.test.ts"]);
  });

  it("groups heuristically at prompts and activity changes", () => {
    const phases = heuristicPhases(raw);
    expect(phases.map((p) => p.type)).toEqual(["plan", "build", "verify", "docs"].filter((t) => phases.some((p) => p.type === t)));
    expect(phases[0].prompt).toBe("Add rate limiting to login");
    expect(phases.at(-1)!.type).toBe("docs");
    expect(phases.length).toBeLessThanOrEqual(4);
  });

  it("takes model groupings, quoting prompts from the capture and keeping free-form types", () => {
    const phases = phasesFromModel(raw, [
      { from: 0, to: 1, type: "plan", label: "Choose limiter design", promptIndex: 0, decisions: [{ text: "Per user", why: "shared IPs" }] },
      { from: 2, to: 3, type: "build", label: "Implement and test", promptIndex: null },
      { from: 4, to: 5, type: "Research", label: "Docs", promptIndex: 1 },
      { from: 9, to: 2, type: "bad", label: "ignored" },
    ]);
    expect(phases.map((p) => p.type)).toEqual(["plan", "build", "research"]);
    expect(phases[0]).toMatchObject({ prompt: "Add rate limiting to login", prompts: 1, decisions: [{ text: "Per user", why: "shared IPs" }] });
    expect(phases[1]).toMatchObject({ prompt: null, files: 2, commands: 1 });
  });

  it("falls back to heuristics on malformed model output", () => {
    expect(phasesFromModel(raw, "nope").length).toBeGreaterThan(0);
  });
});

describe("redaction order", () => {
  it("redacts before truncating so a cut-off key cannot leak", () => {
    const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    expect(truncate(redact(`My key is ${key}`), 30)).not.toContain("sk-proj");
  });
});

const fp = (type: string, label: string, extra: Partial<FlowPhase> = {}): FlowPhase => ({
  type,
  label,
  prompt: null,
  decisions: [],
  prompts: 0,
  files: 1,
  commands: 0,
  sessions: ["s1"],
  commits: [],
  ...extra,
});

describe("mergeToMax", () => {
  it("merges same-type neighbours first and keeps commits", () => {
    const merged = mergeToMax([fp("build", "a", { commits: ["c1"] }), fp("build", "b"), fp("fix", "c", { commits: ["c2"] })], 2);
    expect(merged.map((p) => p.type)).toEqual(["build", "fix"]);
    expect(merged[0].commits).toEqual(["c1"]);
    expect(merged[0].label).toBe("a + b");
  });

  it("caps any number of chunks", () => {
    const many = Array.from({ length: 37 }, (_, i) => fp(["plan", "build", "fix"][i % 3], `p${i}`, { commits: [`c${i}`] }));
    const merged = mergeToMax(many, 10);
    expect(merged).toHaveLength(10);
    expect(merged.flatMap((p) => p.commits)).toHaveLength(37);
  });
});

describe("renderFlow", () => {
  const entries: CommitEntry[] = [
    { sha: raw.sha, subject: raw.subject, context: heuristicContext(raw) },
    { sha: "bbbbbbb2222", subject: "chore: manual tweak", context: null },
  ];

  it("draws a Mermaid flowchart with typed, numbered chunks and commit nodes", () => {
    const md = renderFlow(entries);
    expect(md).toContain("```mermaid\nflowchart TD");
    expect(md).toMatch(/P0\["<b>① 🧭 Plan<\/b>/);
    expect(md).toContain('(["⎇ aaaaaaa"]):::commit');
    expect(md).toContain("✋ Manual");
    expect(md).toContain("classDef plan");
  });

  it("lists each chunk with its prompt or an AI-driven marker and decisions", () => {
    const md = renderFlow(entries);
    expect(md).toContain("> 🧑‍💻 Add rate limiting to login");
    expect(md).toContain("**Per IP or per user? → Per user**");
    expect(md).toContain("The agent continued on its own");
  });

  it("falls back to one chunk per commit for notes without phases", () => {
    const ctx = { ...heuristicContext(raw), phases: undefined };
    const phases = collectPhases([{ sha: "c", subject: "old note", context: ctx }]);
    expect(phases).toHaveLength(1);
    expect(phases[0]).toMatchObject({ type: "build", label: "old note", commits: ["c"] });
  });

  it("shows session badges only when several sessions contributed", () => {
    const two = renderFlow([
      { sha: "x1", subject: "a", context: { ...heuristicContext(raw), phases: [{ type: "build", label: "A", prompt: null, decisions: [], prompts: 1, files: 1, commands: 0, sessionId: "s1" }] } },
      { sha: "x2", subject: "b", context: { ...heuristicContext(raw), phases: [{ type: "fix", label: "B", prompt: null, decisions: [], prompts: 1, files: 1, commands: 0, sessionId: "s2" }] } },
    ]);
    expect(two).toContain("· S2");
    expect(renderFlow(entries)).not.toContain("· S1");
  });
});
