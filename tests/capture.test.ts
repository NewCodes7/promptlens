import { describe, expect, it } from "vitest";
import { buildCapture, toRepoPath } from "../src/capture.js";
import { parseSessionLog } from "../src/sessions.js";
import { ROOT, toolUse, userPrompt } from "./fixtures.js";

const events = parseSessionLog(
  [
    // Before the window: belongs to the previous commit.
    userPrompt("old", "2026-11-09T00:00:00Z", "old work"),
    toolUse("old", "2026-11-09T00:00:10Z", "Edit", { file_path: `${ROOT}/src/a.ts` }),
    // Session A edits a committed file.
    userPrompt("A", "2026-11-09T01:00:00Z", "implement feature a"),
    toolUse("A", "2026-11-09T01:00:10Z", "Write", { file_path: `${ROOT}/src/a.ts` }),
    // Session B (parallel) edits another committed file.
    userPrompt("B", "2026-11-09T01:10:00Z", "write tests for a"),
    toolUse("B", "2026-11-09T01:10:10Z", "Edit", { file_path: `${ROOT}/tests/a.test.ts` }),
    // Session C only touched an uncommitted file → not part of this commit.
    userPrompt("C", "2026-11-09T01:20:00Z", "unrelated spike"),
    toolUse("C", "2026-11-09T01:20:10Z", "Edit", { file_path: `${ROOT}/scratch.ts` }),
    // Session D only chatted, no edits → not linked.
    userPrompt("D", "2026-11-09T01:25:00Z", "what is a monad"),
  ].join("\n"),
);

describe("buildCapture", () => {
  const capture = buildCapture(events, {
    root: ROOT,
    sha: "abc123",
    subject: "feat: a",
    from: "2026-11-09T09:30:00+09:00", // 00:30Z
    to: "2026-11-09T10:30:00+09:00", // 01:30Z
    filesChanged: ["src/a.ts", "tests/a.test.ts"],
  });

  it("links every session that edited a committed file inside the window", () => {
    expect(capture.sessions.map((s) => s.sessionId)).toEqual(["A", "B"]);
  });

  it("keeps the session's prompts and repo-relative edits", () => {
    expect(capture.sessions[0].prompts.map((p) => p.text)).toEqual(["implement feature a"]);
    expect(capture.sessions[1].edits[0].file).toBe("tests/a.test.ts");
  });

  it("carries forward the last earlier instruction when a session had no new prompt in the window", () => {
    const later = buildCapture(events, {
      root: ROOT,
      sha: "def",
      subject: "fix: a",
      from: "2026-11-09T01:05:00Z",
      to: "2026-11-09T01:30:00Z",
      filesChanged: ["src/a.ts"],
    });
    expect(later.sessions).toHaveLength(0); // A's edit was before this window

    const followUp = parseSessionLog(
      [userPrompt("A", "2026-11-09T01:00:00Z", "implement feature a"), toolUse("A", "2026-11-09T01:20:00Z", "Edit", { file_path: `${ROOT}/src/a.ts` })].join("\n"),
    );
    const cap = buildCapture(followUp, { root: ROOT, sha: "x", subject: "x", from: "2026-11-09T01:05:00Z", to: "2026-11-09T01:30:00Z", filesChanged: ["src/a.ts"] });
    expect(cap.sessions[0].prompts).toEqual([{ ts: "2026-11-09T01:00:00Z", text: "implement feature a", carried: true }]);
  });

  it("counts shell commands that write a committed file as AI edits, but not reads", () => {
    const ev = parseSessionLog(
      [
        userPrompt("S", "2026-11-09T01:00:00Z", "tweak config"),
        toolUse("S", "2026-11-09T01:00:10Z", "Bash", { command: "cat src/b.ts" }),
        toolUse("S", "2026-11-09T01:00:20Z", "Bash", { command: "sed -i '' 's/a/b/' src/c.ts" }),
      ].join("\n"),
    );
    const cap = buildCapture(ev, { root: ROOT, sha: "x", subject: "x", from: "2026-11-09T00:30:00Z", to: "2026-11-09T01:30:00Z", filesChanged: ["src/b.ts", "src/c.ts"] });
    expect(cap.sessions[0].edits).toEqual([{ ts: "2026-11-09T01:00:20Z", tool: "Bash", file: "src/c.ts" }]);
  });

  it("uses a 24h lookback for root commits", () => {
    const root = buildCapture(events, {
      root: ROOT,
      sha: "r",
      subject: "init",
      from: null,
      to: "2026-11-09T01:30:00Z",
      filesChanged: ["src/a.ts"],
    });
    expect(root.sessions.map((s) => s.sessionId)).toEqual(["old", "A"]);
  });
});

describe("toRepoPath", () => {
  it("handles absolute, relative and worktree paths", () => {
    expect(toRepoPath(ROOT, `${ROOT}/src/x.ts`)).toBe("src/x.ts");
    expect(toRepoPath(ROOT, "./src/x.ts")).toBe("src/x.ts");
    expect(toRepoPath(ROOT, "/work/app/.claude/worktrees/feat/src/x.ts")).toBe("src/x.ts");
    expect(toRepoPath(ROOT, "/elsewhere/x.ts")).toBe("/elsewhere/x.ts");
  });
});
