import { describe, expect, it } from "vitest";
import { parseAnswers, parseSessionLog, projectDirName, SELF_MARKER } from "../src/sessions.js";
import { assistantText, ROOT, toolResult, toolUse, userPrompt } from "./fixtures.js";

describe("parseSessionLog", () => {
  it("extracts prompts, edits, commands, notes and AskUserQuestion decisions", () => {
    const log = [
      userPrompt("s1", "2026-11-09T01:00:00Z", "Add rate limiting to the login endpoint"),
      assistantText("s1", "2026-11-09T01:00:05Z", "I'll use a token bucket."),
      toolUse("s1", "2026-11-09T01:00:10Z", "AskUserQuestion", { questions: [] }, "ask1"),
      toolResult("s1", "2026-11-09T01:00:20Z", "ask1", 'User answered: "Limit per IP or per user?"="Per user"'),
      toolUse("s1", "2026-11-09T01:00:30Z", "Edit", { file_path: `${ROOT}/src/login.ts` }),
      toolUse("s1", "2026-11-09T01:00:40Z", "Bash", { command: "npm test", description: "Run tests" }),
    ].join("\n");
    const ev = parseSessionLog(log);
    expect(ev.map((e) => e.kind)).toEqual(["prompt", "note", "decision", "edit", "command"]);
    expect(ev[2]).toMatchObject({ question: "Limit per IP or per user?", answer: "Per user" });
    expect(ev[3]).toMatchObject({ tool: "Edit", file: `${ROOT}/src/login.ts` });
  });

  it("drops harness noise, meta messages, sidechains, tool results and PromptLens' own prompts", () => {
    const log = [
      userPrompt("s1", "2026-11-09T01:00:00Z", "<command-name>/clear</command-name>"),
      userPrompt("s1", "2026-11-09T01:00:01Z", "hidden", { isMeta: true }),
      userPrompt("s1", "2026-11-09T01:00:02Z", "subagent prompt", { isSidechain: true }),
      userPrompt("s1", "2026-11-09T01:00:03Z", `${SELF_MARKER}\nsummarize this`),
      toolResult("s1", "2026-11-09T01:00:04Z", "x", "file contents"),
      "not json",
      "",
      userPrompt("s1", "2026-11-09T01:00:05Z", "real prompt"),
    ].join("\n");
    const prompts = parseSessionLog(log).filter((e) => e.kind === "prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ text: "real prompt" });
  });

  it("accepts array content with text blocks (e.g. prompts with images)", () => {
    const line = JSON.stringify({
      type: "user",
      sessionId: "s1",
      timestamp: "2026-11-09T01:00:00Z",
      cwd: ROOT,
      message: { content: [{ type: "image" }, { type: "text", text: "fix this layout" }] },
    });
    expect(parseSessionLog(line)[0]).toMatchObject({ kind: "prompt", text: "fix this layout" });
  });
});

describe("helpers", () => {
  it("parses multiple answers including escaped quotes", () => {
    expect(parseAnswers('"A?"="yes","B \\"x\\"?"="no"')).toEqual([
      { question: "A?", answer: "yes" },
      { question: 'B \\"x\\"?', answer: "no" },
    ]);
  });

  it("mirrors Claude Code's project directory naming", () => {
    expect(projectDirName("/Users/me/my.repo")).toBe("-Users-me-my-repo");
  });
});
