import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { summarize } from "../src/summarize.js";
import type { RawCapture } from "../src/types.js";

/**
 * The provider chain end to end: a fake `claude` executable is put first on PATH, so `claude -p`
 * really runs as a child process, and OpenAI is a stubbed fetch.
 */
const ENV_KEYS = [
  "PATH",
  "OPENAI_API_KEY",
  "PROMPTLENS_PROVIDER",
  "PROMPTLENS_NO_LLM",
  "FAKE_CLAUDE_MODE",
  "FAKE_CLAUDE_OUT",
  "FAKE_CLAUDE_LOG",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let tmp: string;
let repo: string;
let log: string;
let raw: RawCapture;

const model = {
  intent: { text: "Add a greet helper for the CLI", inferred: false },
  keyPrompts: [{ index: 0, why: "states the goal" }],
  decisions: [{ text: "Kept greet() pure", inferred: true }],
  aiWork: ["Wrote greet.js"],
  verification: [{ text: "Ran node --test", inferred: false }],
};

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "promptlens-providers-")));
  const bin = path.join(tmp, "bin");
  mkdirSync(bin);
  const claude = path.join(bin, "claude");
  writeFileSync(
    claude,
    [
      "#!/bin/sh",
      "cat > /dev/null",
      'echo called >> "$FAKE_CLAUDE_LOG"',
      'case "$FAKE_CLAUDE_MODE" in',
      `  ok) printf '%s' "$FAKE_CLAUDE_OUT" ;;`,
      `  error) printf '%s' '{"type":"result","is_error":true,"result":"usage limit reached"}' ;;`,
      "  *) echo 'not logged in' >&2; exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(claude, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`;

  repo = path.join(tmp, "repo");
  mkdirSync(repo);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@test.dev");
  sh("config", "user.name", "t");
  writeFileSync(path.join(repo, "greet.js"), "export const greet = (n) => n;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "feat: greet");
  raw = {
    version: 1,
    sha: sh("rev-parse", "HEAD"),
    subject: "feat: greet",
    window: { from: null, to: new Date().toISOString() },
    filesChanged: ["greet.js"],
    sessions: [
      {
        sessionId: "s1",
        agent: "claude-code",
        prompts: [{ ts: "2026-11-09T01:00:00Z", text: "Add a greet helper" }],
        edits: [{ ts: "2026-11-09T01:01:00Z", tool: "Write", file: "greet.js" }],
        commands: [],
        decisions: [],
        assistantNotes: [],
      },
    ],
  };
});

beforeEach(() => {
  log = path.join(tmp, `calls-${Math.random().toString(36).slice(2)}.log`);
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_OUT = JSON.stringify({
    type: "result",
    is_error: false,
    result: `Here is the summary:\n\`\`\`json\n${JSON.stringify(model)}\n\`\`\``,
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (k === "PATH") continue;
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

afterAll(() => {
  process.env.PATH = saved.PATH;
  rmSync(tmp, { recursive: true, force: true });
});

const claudeCalls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0);
const stubOpenAi = (content: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("summarize provider chain", () => {
  it("uses the local claude CLI first, and reads JSON wrapped in prose and a code fence", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    const ctx = await summarize(raw, repo);
    expect(ctx.generatedBy).toBe("claude-cli");
    expect(ctx.intent).toEqual({ text: "Add a greet helper for the CLI", inferred: false });
    expect(ctx.keyPrompts[0]?.text).toBe("Add a greet helper");
    expect(ctx.decisions).toEqual([{ text: "Kept greet() pure", inferred: true }]);
    expect(claudeCalls()).toBe(1);
  });

  it("falls back to OpenAI when claude fails", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail";
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = stubOpenAi(model);
    const ctx = await summarize(raw, repo);
    expect(ctx.generatedBy).toBe("openai");
    expect(claudeCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0])).toContain("claude -p summary failed");
  });

  it("treats an is_error envelope from claude as a failure, not an empty summary", async () => {
    process.env.FAKE_CLAUDE_MODE = "error";
    const ctx = await summarize(raw, repo);
    expect(ctx.generatedBy).toBe("heuristic");
    expect(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0])).toContain("usage limit reached");
  });

  it("ends with the heuristic when claude fails and there is no OpenAI key", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = await summarize(raw, repo);
    expect(ctx.generatedBy).toBe("heuristic");
    expect(ctx.keyPrompts[0]?.text).toBe("Add a greet helper");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends with the heuristic when OpenAI also fails", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail";
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    expect((await summarize(raw, repo)).generatedBy).toBe("heuristic");
  });

  it("skips claude when PROMPTLENS_PROVIDER=openai", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    process.env.PROMPTLENS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    stubOpenAi(model);
    expect((await summarize(raw, repo)).generatedBy).toBe("openai");
    expect(claudeCalls()).toBe(0);
  });

  it("calls no model at all with PROMPTLENS_NO_LLM=1", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    process.env.PROMPTLENS_NO_LLM = "1";
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await summarize(raw, repo)).generatedBy).toBe("heuristic");
    expect(claudeCalls()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not run a model for a commit with no AI session", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    expect((await summarize({ ...raw, sessions: [] }, repo)).generatedBy).toBe("heuristic");
    expect(claudeCalls()).toBe(0);
  });
});
