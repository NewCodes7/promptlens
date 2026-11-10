import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CommitEntry } from "../src/report.js";
import { renderReport, templateSynthesis } from "../src/report.js";
import { renderReviewFile, reviewFilePath, reviewFileUrl } from "../src/review.js";
import { heuristicContext } from "../src/summarize.js";
import type { RawCapture } from "../src/types.js";

const raw: RawCapture = {
  version: 1,
  sha: "abcdef1234567",
  subject: "feat: login limit",
  window: { from: null, to: "2026-11-09T02:00:00Z" },
  filesChanged: ["src/login.ts"],
  sessions: [
    {
      sessionId: "s1",
      agent: "claude-code",
      prompts: [{ ts: "2026-11-09T01:00:00Z", text: "로그인에 rate limit 추가해줘\n유저별로 <bucket> 써줘" }],
      decisions: [{ ts: "2026-11-09T01:01:00Z", question: "Per IP or per user?", answer: "Per user" }],
      edits: [{ ts: "2026-11-09T01:05:00Z", tool: "Edit", file: "src/login.ts" }],
      commands: [{ ts: "2026-11-09T01:06:00Z", command: "npx vitest run", description: "Run tests" }],
      assistantNotes: [],
    },
  ],
};
const entries: CommitEntry[] = [
  { sha: raw.sha, subject: raw.subject, context: heuristicContext(raw) },
  { sha: "9999999000000", subject: "chore: bump deps", context: null },
];
const prompt = raw.sessions[0].prompts[0].text;

describe("renderReviewFile", () => {
  it("lays prompts out one source line per prompt line, with the translation below", () => {
    const md = renderReviewFile(entries, 12, { translations: new Map([[prompt, "Add rate limiting to login\nUse a per-user bucket"]]) });
    expect(md).toContain("# 🔍 PromptLens — PR #12 prompt flow");
    expect(md).toContain("> 로그인에 rate limit 추가해줘\n> 유저별로 &lt;bucket&gt; 써줘");
    expect(md).toContain("🌐 English:\n\n> Add rate limiting to login\n> Use a per-user bucket");
    expect(md).toContain("`abcdef1`");
    expect(md).toContain("✋ Committed without an AI session.");
    expect(md).not.toMatch(/<details>|\d{4}-\d{2}-\d{2}T/);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("is deterministic and handles a PR without AI context", () => {
    expect(renderReviewFile(entries, 3)).toBe(renderReviewFile(entries, 3));
    expect(renderReviewFile([], 3)).toContain("No AI work context was recorded");
  });
});

describe("review file links", () => {
  it("points at the file's diff anchor in Files changed", () => {
    expect(reviewFilePath(5)).toBe(".promptlens/PR-5.md");
    const hash = createHash("sha256").update(".promptlens/PR-5.md").digest("hex");
    expect(reviewFileUrl("o/r", 5)).toBe(`https://github.com/o/r/pull/5/files#diff-${hash}`);
  });

  it("the PR comment links to it only when it was committed", () => {
    const syn = templateSynthesis(entries);
    const reviewFile = { path: reviewFilePath(5), url: reviewFileUrl("o/r", 5) };
    expect(renderReport(entries, syn, { reviewFile })).toContain(`[\`.promptlens/PR-5.md\`](${reviewFile.url})`);
    expect(renderReport(entries, syn)).not.toContain(".promptlens/");
  });
});
