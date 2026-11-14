import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { pkg } from "../src/pkg.js";
import { projectDirName } from "../src/sessions.js";

/** Every command run through `main()` inside a throwaway repo whose `origin` is a local bare repo. */
const ENV_KEYS = [
  "PROMPTLENS_CLAUDE_PROJECTS",
  "PROMPTLENS_NO_LLM",
  "GITHUB_EVENT_PATH",
  "GITHUB_TOKEN",
  "GITHUB_REPOSITORY",
  "OPENAI_API_KEY",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const cwd = process.cwd();

let tmp: string;
let repo: string;
let remote: string;
let baseSha: string;
let featSha: string;

const sh = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** Run one command and collect what it printed. */
async function run(argv: string[], stdin = ""): Promise<{ out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  try {
    await main(argv, () => stdin);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { out: out.join("\n"), err: err.join("\n") };
}

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "promptlens-cli-")));
  repo = path.join(tmp, "repo");
  remote = path.join(tmp, "remote.git");
  const projects = path.join(tmp, "claude-projects");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "--bare", remote]);
  process.env.PROMPTLENS_CLAUDE_PROJECTS = projects;
  process.env.PROMPTLENS_NO_LLM = "1";
  delete process.env.OPENAI_API_KEY;

  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@test.dev");
  sh(repo, "config", "user.name", "t");
  sh(repo, "remote", "add", "origin", remote);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  sh(repo, "add", ".");
  execFileSync("git", ["commit", "-q", "-m", "init"], {
    cwd: repo,
    env: { ...process.env, GIT_COMMITTER_DATE: new Date(Date.now() - 600_000).toISOString() },
  });
  sh(repo, "push", "-q", "origin", "main");
  baseSha = sh(repo, "rev-parse", "HEAD");

  // A Claude Code session that writes greet.js, then the commit that contains it.
  const sessionDir = path.join(projects, projectDirName(repo));
  mkdirSync(sessionDir, { recursive: true });
  const ts = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const line = (o: object) => JSON.stringify({ sessionId: "sess-1", cwd: repo, ...o });
  writeFileSync(
    path.join(sessionDir, "sess-1.jsonl"),
    [
      line({ type: "user", timestamp: ts(120), message: { content: "Add a greet() helper" } }),
      line({
        type: "assistant",
        timestamp: ts(100),
        message: { content: [{ type: "tool_use", id: "e1", name: "Write", input: { file_path: path.join(repo, "greet.js") } }] },
      }),
    ].join("\n"),
  );
  writeFileSync(path.join(repo, "greet.js"), "export const greet = (n) => n;\n");
  sh(repo, "checkout", "-q", "-b", "feat");
  sh(repo, "add", "greet.js");
  sh(repo, "commit", "-q", "-m", "feat: greet");
  featSha = sh(repo, "rev-parse", "HEAD");
  process.chdir(repo);
});

afterAll(() => {
  process.chdir(cwd);
  process.exitCode = undefined;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  rmSync(tmp, { recursive: true, force: true });
});

describe("help and errors", () => {
  it("prints the version", async () => {
    expect((await run(["--version"])).out).toBe(pkg.version);
  });

  it.each([[[]], [["help"]], [["--help"]], [["-h"]]])("prints the usage for %j", async (argv) => {
    const { out } = await run(argv);
    expect(out).toContain("Usage:");
    expect(process.exitCode).toBeUndefined();
  });

  it("fails an unknown command with exit code 1 and a suggestion", async () => {
    const { out, err } = await run(["reprot"]);
    expect(out).toBe("");
    expect(err).toContain("unknown command: reprot (did you mean `promptlens report`?)");
    expect(err).toContain("Usage:");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe("commit context", () => {
  it("captures the session and writes the note with --sync", async () => {
    const { out } = await run(["capture", "--sync"]);
    expect(out).toContain(`${featSha.slice(0, 7)}: written`);
    expect(out).toContain("captured 1 AI session(s), 1 prompt(s)");
  });

  it("shows the note, and says so when a commit has none", async () => {
    expect((await run(["show"])).out).toContain("Add a greet() helper");
    expect((await run(["show", baseSha])).out).toBe("No Commit Context for this commit.");
  });

  it("keeps an existing note, and rewrites it with --force", async () => {
    expect((await run(["summarize"])).out).toBe(`${featSha.slice(0, 7)}: exists`);
    expect((await run(["summarize", "--force"])).out).toBe(`${featSha.slice(0, 7)}: written`);
  });
});

describe("reports", () => {
  it("previews the PR comment and the review file locally", async () => {
    expect((await run(["report", "--base", "main"])).out).toContain("Add a greet() helper");
    expect((await run(["report", "--base", "main", "--file", "--pr", "3"])).out).toContain("Add a greet() helper");
  });

  it("posts the review file and the comment from GitHub Actions", async () => {
    const eventPath = path.join(tmp, "event.json");
    const event = (headRepo: string) =>
      writeFileSync(
        eventPath,
        JSON.stringify({
          pull_request: { number: 3, base: { sha: baseSha }, head: { sha: featSha, ref: "feat", repo: { full_name: headRepo } } },
        }),
      );
    event("o/r");
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_TOKEN = "tkn";
    process.env.GITHUB_REPOSITORY = "o/r";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        calls.push(`${method} ${url.replace("https://api.github.com", "")}`);
        if (url.includes("/contents/")) {
          return method === "GET"
            ? new Response("Not Found", { status: 404 })
            : new Response(JSON.stringify({ commit: { sha: "c0ffee1234" } }));
        }
        if (method === "GET") return new Response("[]");
        return new Response(JSON.stringify({ id: 9, html_url: "https://github.com/o/r/pull/3#issuecomment-9", body: "" }));
      }),
    );

    const posted = await run(["pr-report", "--post"]);
    expect(posted.out).toContain("PromptLens review file created: .promptlens/PR-3.md (c0ffee1)");
    expect(posted.out).toContain("PromptLens report created: https://github.com/o/r/pull/3#issuecomment-9");
    expect(calls).toContain("PUT /repos/o/r/contents/.promptlens/PR-3.md");

    // A fork PR gets a read-only token: comment only, no commit to the branch.
    event("someone/fork");
    calls.length = 0;
    const fork = await run(["pr-report", "--post"]);
    expect(fork.out).toContain("review file skipped");
    expect(calls.some((c) => c.startsWith("PUT"))).toBe(false);

    delete process.env.GITHUB_TOKEN;
    await expect(run(["pr-report", "--post"])).rejects.toThrow("--post needs GITHUB_TOKEN");
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_REPOSITORY;
  });
});

describe("sync (pre-push)", () => {
  it("pushes the notes ref for the commits being pushed", async () => {
    const zero = "0".repeat(40);
    const { err } = await run(["sync", "origin"], `refs/heads/feat ${featSha} refs/heads/feat ${zero}\n`);
    expect(err).toContain("synced Commit Context for 1 commit(s) (0 new) → origin refs/notes/promptlens");
    expect(sh(remote, "notes", "--ref=refs/notes/promptlens", "show", featSha)).toContain("Add a greet() helper");
  });

  it("reports a failed notes push instead of blocking the git push", async () => {
    sh(repo, "remote", "add", "broken", path.join(tmp, "missing.git"));
    const zero = "0".repeat(40);
    const { err } = await run(["sync", "broken"], `refs/heads/feat ${featSha} refs/heads/feat ${zero}\n`);
    expect(err).toContain("could not push notes");
  });
});

describe("init", () => {
  it("installs the hooks pointing at the CLI entry point", async () => {
    const { out } = await run(["init", "--no-workflow"]);
    expect(out).toContain("PromptLens initialized:");
    expect(readFileSync(path.join(repo, ".git/hooks/post-commit"), "utf8")).toContain("cli.js");
    expect(readFileSync(path.join(repo, ".git/hooks/pre-push"), "utf8")).toContain('sync "$1"');
  });
});
