import { describe, expect, it } from "vitest";
import { collectTurns, duration, mergeToMax, renderFlow, type FlowTurn } from "../src/flow.js";
import { redact, truncate } from "../src/redact.js";
import type { CommitEntry } from "../src/report.js";
import { heuristicContext } from "../src/summarize.js";
import { buildTurns, heuristicGroups, heuristicTurns, turnsForPrompt, turnsFromModel } from "../src/turns.js";
import type { CommitContext, RawCapture, Turn } from "../src/types.js";

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
        { ts: "2026-11-09T01:00:00Z", text: "로그인에 rate limit 추가해줘" },
        { ts: "2026-11-09T01:20:00Z", text: "Yes, do it" },
        { ts: "2026-11-09T01:30:00Z", text: "Now document it in the README" },
      ],
      decisions: [{ ts: "2026-11-09T01:01:00Z", question: "Per IP or per user?", answer: "Per user" }],
      edits: [
        { ts: "2026-11-09T01:05:00Z", tool: "Edit", file: "src/login.ts" },
        { ts: "2026-11-09T01:06:00Z", tool: "Write", file: "tests/login.test.ts" },
        { ts: "2026-11-09T01:31:00Z", tool: "Edit", file: "README.md" },
      ],
      commands: [
        { ts: "2026-11-09T01:10:00Z", command: "npx vitest run", description: "Run tests" },
        { ts: "2026-11-09T01:21:00Z", command: "npx vitest run", description: "Run tests" },
      ],
      assistantNotes: [],
    },
  ],
};

describe("turns", () => {
  it("starts a turn per request and folds short follow-ups into the previous one", () => {
    expect(heuristicGroups(raw).map((g) => g.prompts)).toEqual([[0, 1], [2]]);
  });

  it("attributes everything the agent did to the request it was working on", () => {
    const [first, second] = heuristicTurns(raw);
    expect(first.prompts).toEqual(["로그인에 rate limit 추가해줘", "Yes, do it"]);
    expect(first.steps.map((s) => s.type)).toEqual(["plan", "build", "verify"]);
    expect(first.metrics).toMatchObject({ aiSteps: 4, files: 2, reruns: 1, start: "2026-11-09T01:00:00Z", end: "2026-11-09T01:21:00Z" });
    expect(first.decisions[0].text).toBe("Per IP or per user? → Per user");
    expect(second.steps.map((s) => s.type)).toEqual(["docs"]);
    expect(second.key).toBe("s1@2026-11-09T01:30:00Z");
  });

  it("uses the model's grouping, titles, steps and prompt review, but quotes prompts from the capture", () => {
    const turns = turnsFromModel(raw, [
      {
        prompts: [0, 1],
        title: "Add per-user rate limiting to login",
        steps: [{ type: "plan", text: "Asked IP vs user" }, { type: "build", text: "Token bucket middleware" }],
        outcome: "Limiter in place; tests pass",
        decisions: [{ text: "Per user", why: "Shared office IPs" }],
        tips: { keep: ["Stated the endpoint precisely"], improve: ["Give the limit numbers up front"] },
      },
      { prompts: [2, 2, 99], title: "Document the limiter" },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ title: "Add per-user rate limiting to login", outcome: "Limiter in place; tests pass", prompts: ["로그인에 rate limit 추가해줘", "Yes, do it"] });
    expect(turns[0].tips).toEqual({ keep: ["Stated the endpoint precisely"], improve: ["Give the limit numbers up front"] });
    expect(turns[1].steps.map((s) => s.type)).toEqual(["docs"]);
  });

  it("covers prompts the model forgot and falls back on garbage", () => {
    expect(buildTurns(raw, [{ prompts: [0] }]).map((t) => t.prompts.length)).toEqual([1, 1, 1]);
    expect(turnsFromModel(raw, "nope")).toHaveLength(2);
  });

  it("marks continued requests as carried and leaves their prompt out of the piece", () => {
    const carried: RawCapture = { ...raw, sessions: [{ ...raw.sessions[0], prompts: [{ ts: "2026-11-09T00:50:00Z", text: "old request", carried: true }] }] };
    const [t] = heuristicTurns(carried);
    expect(t).toMatchObject({ carried: true, prompts: [], title: "old request" });
  });

  it("lists each prompt with the agent's actions for the summarizer", () => {
    const text = turnsForPrompt(raw);
    expect(text).toContain("PROMPT[0]: 로그인에 rate limit 추가해줘");
    expect(text).toContain("    - ASKED Per IP or per user? → Per user");
    expect(text).toContain("    - EDIT README.md");
  });
});

describe("redaction order", () => {
  it("redacts before truncating so a cut-off key cannot leak", () => {
    const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    expect(truncate(redact(`My key is ${key}`), 30)).not.toContain("sk-proj");
  });
});

const turn = (key: string, extra: Partial<Turn> = {}): Turn => ({
  key,
  title: key,
  prompts: [],
  carried: false,
  steps: [{ type: "build", text: "" }],
  outcome: "",
  decisions: [],
  tips: { keep: [], improve: [] },
  metrics: { start: "2026-11-09T01:00:00Z", end: "2026-11-09T01:10:00Z", aiSteps: 2, files: 1, reruns: 0 },
  sessionId: "s1",
  ...extra,
});
const ctx = (turns: Turn[]): CommitContext => ({ ...heuristicContext(raw), turns });

describe("collectTurns", () => {
  it("merges a request that spans commits and hangs each commit off the active request", () => {
    const entries: CommitEntry[] = [
      { sha: "c1", subject: "a", context: ctx([turn("A", { prompts: ["build it"], title: "Build it", tips: { keep: ["clear"], improve: [] } })]) },
      { sha: "c2", subject: "b", context: ctx([turn("A", { carried: true, title: "cont", steps: [{ type: "verify", text: "" }], outcome: "done" }), turn("B", { prompts: ["fix"] })]) },
      { sha: "c3", subject: "manual", context: null },
    ];
    const t = collectTurns(entries);
    expect(t.map((x) => x.key)).toEqual(["A", "B", "manual@c3"]);
    expect(t[0]).toMatchObject({ title: "Build it", outcome: "done", commits: ["c1"], tips: { keep: ["clear"] } });
    expect(t[0].steps.map((s) => s.type)).toEqual(["build", "verify"]);
    expect(t[0].metrics.aiSteps).toBe(4);
    expect(t[1].commits).toEqual(["c2"]);
    expect(t[2].manual).toBe(true);
  });

  it("falls back to one request per commit for notes without turns", () => {
    const t = collectTurns([{ sha: "c", subject: "old note", context: { ...heuristicContext(raw), turns: undefined } }]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: "old note", commits: ["c"] });
  });
});

describe("mergeToMax", () => {
  it("caps any number of requests and keeps every commit", () => {
    const many: FlowTurn[] = collectTurns(
      Array.from({ length: 23 }, (_, i) => ({ sha: `c${i}`, subject: `s${i}`, context: ctx([turn(`K${i}`, { prompts: ["p"] })]) })),
    );
    const merged = mergeToMax(many, 10);
    expect(merged).toHaveLength(10);
    expect(merged.flatMap((t) => t.commits)).toHaveLength(23);
  });
});

describe("renderFlow", () => {
  const entries: CommitEntry[] = [
    { sha: "aaaaaaa1111", subject: raw.subject, context: ctx(turnsFromModel(raw, [{ prompts: [0, 1], title: "Add rate limiting", outcome: "Tests pass", tips: { keep: ["Precise target"], improve: ["Give numbers"] } }, { prompts: [2], title: "Document it" }])) },
    { sha: "bbbbbbb2222", subject: "chore: manual tweak", context: null },
  ];
  const md = renderFlow(entries);

  it("draws one node per request with step chips, outcome and metrics", () => {
    expect(md).toContain("```mermaid\n%%{init:");
    expect(md).toContain("\nflowchart TD\n");
    expect(md).toMatch(/T0\["<b>① 🧑‍💻 Add rate limiting<\/b><br\/>🧭 Plan → 🛠️ Build → 🧪 Verify<br\/>✅ Tests pass<br\/>⏱ 21m · 💬 2 prompts · 🤖 4 AI steps · 📄 2 files · 🔁 1 re-runs"\]/);
    expect(md).toContain('T1 -->|"⎇ aaaaaaa"| T2');
    expect(md).toContain('T2 --- END(["⎇ bbbbbbb"]):::commit');
  });

  it("details each request with verbatim prompts, AI steps and a two-sided prompt review", () => {
    expect(md).toContain("> 로그인에 rate limit 추가해줘");
    expect(md).toContain("- 🧭 **Plan**");
    expect(md).toContain("- 👍 **Keep:** Precise target");
    expect(md).toContain("- 💡 **Try:** Give numbers");
    expect(md).toContain("✋ chore: manual tweak");
  });

  it("formats durations", () => {
    expect(duration("2026-11-09T01:00:00Z", "2026-11-09T02:12:00Z")).toBe("1h12m");
    expect(duration("2026-11-09T01:00:00Z", "2026-11-09T01:00:20Z")).toBe("20s");
    expect(duration("", "")).toBe("");
  });
});

describe("normalizeType", () => {
  it("maps synonyms onto the fixed step types and keeps unknown ones", async () => {
    const { normalizeType } = await import("../src/turns.js");
    expect(["Test", "debug", "implement", "research", "migrate"].map(normalizeType)).toEqual(["verify", "fix", "build", "investigate", "migrate"]);
  });
});

describe("whole-request outcomes", () => {
  it("parses per-request outcomes from the PR synthesis and overrides the piece outcome", async () => {
    const { synthesisFromModel } = await import("../src/openai.js");
    const { templateSynthesis } = await import("../src/report.js");
    const syn = synthesisFromModel({ overview: "x", requests: [{ index: 0, outcome: "Whole request done" }, { index: "bad", outcome: "y" }] }, "t", templateSynthesis([]));
    expect(syn.turnOutcomes).toEqual(["Whole request done"]);
    const entries: CommitEntry[] = [{ sha: "c1", subject: "a", context: ctx([turn("A", { prompts: ["p"], outcome: "last piece only" })]) }];
    expect(renderFlow(entries, 10, syn.turnOutcomes)).toContain("✅ Whole request done");
    expect(collectTurns(entries)[0].outcomes).toEqual(["last piece only"]);
  });
});
