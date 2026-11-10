import { afterEach, describe, expect, it, vi } from "vitest";
import { needsTranslation, translatePrompts } from "../src/openai.js";
import { type CommitEntry, renderReport, templateSynthesis, translatableTexts } from "../src/report.js";
import { heuristicContext } from "../src/summarize.js";
import type { RawCapture } from "../src/types.js";

const raw: RawCapture = {
  version: 1,
  sha: "abc1234def",
  subject: "feat: x",
  window: { from: null, to: "2026-11-09T02:00:00Z" },
  filesChanged: ["src/x.ts"],
  sessions: [
    {
      sessionId: "s1",
      agent: "claude-code",
      prompts: [{ ts: "2026-11-09T01:00:00Z", text: "PR 결과를 영어로 바꿔줘" }],
      edits: [{ ts: "2026-11-09T01:01:00Z", tool: "Edit", file: "src/x.ts" }],
      commands: [],
      decisions: [],
      assistantNotes: [],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("needsTranslation", () => {
  it("flags non-Latin text only", () => {
    expect(needsTranslation("PR 결과를 영어로")).toBe(true);
    expect(needsTranslation("Fix the bug in src/x.ts → now")).toBe(false);
    expect(needsTranslation("Café résumé")).toBe(false);
  });
});

describe("translatePrompts", () => {
  it("translates only non-English prompts and redacts the result", async () => {
    process.env.OPENAI_API_KEY = "test";
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.messages[0].content).toContain("PR 결과를 영어로 바꿔줘");
      expect(body.messages[0].content).not.toContain("already english");
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ items: [{ id: 0, en: "Change the PR output to English, mail dev@example.com" }] }) } },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const map = await translatePrompts(["PR 결과를 영어로 바꿔줘", "already english", "PR 결과를 영어로 바꿔줘"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(map.get("PR 결과를 영어로 바꿔줘")).toBe("Change the PR output to English, mail [REDACTED:email]");
  });

  it("returns nothing without a key or on API failure", async () => {
    expect((await translatePrompts(["한국어"])).size).toBe(0);
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    expect((await translatePrompts(["한국어"])).size).toBe(0);
  });
});

describe("renderReport with translations", () => {
  it("shows English prompts in the flow and the commit timeline, marked as translated", () => {
    const entries: CommitEntry[] = [{ sha: raw.sha, subject: raw.subject, context: heuristicContext(raw) }];
    const md = renderReport(entries, templateSynthesis(entries), {
      translations: new Map([["PR 결과를 영어로 바꿔줘", "Change the PR output to English"]]),
    });
    expect(md).not.toContain("PR 결과를");
    expect(md).toContain("> Change the PR output to English");
    expect(md).toContain("🌐 Translated to English from the original prompt.");
    expect(md).toContain("· 🌐 translated</sub>");
    expect(md).toContain("<b>① 🧑‍💻 Change the PR output to English</b>");
  });
});

describe("translatableTexts", () => {
  it("collects prompts, titles, intents and decisions from contexts", () => {
    const texts = translatableTexts([
      { sha: raw.sha, subject: raw.subject, context: heuristicContext(raw) },
      { sha: "x", subject: "manual", context: null },
    ]);
    expect(texts).toContain("PR 결과를 영어로 바꿔줘");
  });
});
