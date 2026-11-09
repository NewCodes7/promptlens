import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureCommit, readRaw } from "../src/capture.js";
import { readNote, writeNote } from "../src/git.js";
import { init } from "../src/init.js";
import { collectCommits, parseContext, renderReport, templateSynthesis } from "../src/report.js";
import { projectDirName } from "../src/sessions.js";
import { summarize } from "../src/summarize.js";

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("end to end: session log → commit → note → PR report", () => {
  let repo: string;
  let projects: string;
  const env = { ...process.env };

  beforeAll(() => {
    const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "promptlens-e2e-")));
    repo = path.join(tmp, "repo");
    projects = path.join(tmp, "claude-projects");
    mkdirSync(repo);
    process.env.PROMPTLENS_CLAUDE_PROJECTS = projects;
    process.env.PROMPTLENS_NO_LLM = "1";

    sh(repo, "init", "-q", "-b", "main");
    sh(repo, "config", "user.email", "t@test.dev");
    sh(repo, "config", "user.name", "t");
    sh(repo, "remote", "add", "origin", "https://example.invalid/repo.git");
    writeFileSync(path.join(repo, "README.md"), "# demo\n");
    sh(repo, "add", ".");
    execFileSync("git", ["commit", "-q", "-m", "init"], {
      cwd: repo,
      env: { ...process.env, GIT_COMMITTER_DATE: new Date(Date.now() - 600_000).toISOString() },
    });
  });

  afterAll(() => {
    process.env = env;
  });

  it("init installs hooks, notes config and the workflow", () => {
    const log = init({ cli: "/nonexistent/cli.js", workflow: true, cwd: repo });
    expect(log.join("\n")).toMatch(/post-commit hook: installed/);
    expect(readFileSync(path.join(repo, ".git/hooks/pre-push"), "utf8")).toContain('sync "$1"');
    expect(sh(repo, "config", "notes.rewriteRef")).toBe("refs/notes/promptlens");
    expect(sh(repo, "config", "--get-all", "remote.origin.fetch")).toContain("refs/notes/promptlens");
    expect(existsSync(path.join(repo, ".github/workflows/promptlens.yml"))).toBe(true);
    // Idempotent.
    expect(init({ cli: "/nonexistent/cli.js", workflow: true, cwd: repo }).join("\n")).toMatch(/post-commit hook: present/);
  });

  it("links a Claude Code session to the commit and builds the PR report", async () => {
    const sessionDir = path.join(projects, projectDirName(repo));
    mkdirSync(sessionDir, { recursive: true });
    const ts = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    const line = (o: object) => JSON.stringify({ sessionId: "sess-1", cwd: repo, ...o });
    writeFileSync(
      path.join(sessionDir, "sess-1.jsonl"),
      [
        line({ type: "user", timestamp: ts(120), message: { content: "Add a greet() helper with tests" } }),
        line({ type: "assistant", timestamp: ts(100), message: { content: [{ type: "tool_use", id: "e1", name: "Write", input: { file_path: path.join(repo, "greet.js") } }] } }),
        line({ type: "assistant", timestamp: ts(90), message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "node --test", description: "Run tests" } }] } }),
      ].join("\n"),
    );
    writeFileSync(path.join(repo, "greet.js"), "export const greet = (n) => `hi ${n}`;\n");
    sh(repo, "checkout", "-q", "-b", "feat");
    sh(repo, "add", "greet.js");
    sh(repo, "commit", "-q", "-m", "feat: greet");

    const raw = captureCommit("HEAD", repo);
    expect(raw.sessions).toHaveLength(1);
    expect(readRaw(raw.sha, repo)?.sessions[0].prompts[0].text).toBe("Add a greet() helper with tests");

    const ctx = await summarize(raw, repo);
    writeNote(raw.sha, JSON.stringify(ctx), repo);
    expect(parseContext(readNote(raw.sha, repo))?.verification[0].text).toContain("Run tests");

    const { entries, diffStat } = collectCommits("main", "HEAD", repo);
    expect(entries).toHaveLength(1);
    expect(diffStat).toContain("greet.js");
    const md = renderReport(entries, templateSynthesis(entries));
    expect(md).toContain("Add a greet() helper with tests");
    expect(md).toContain("| 1 | 1 / 1 | 1 | 1 | 1 / 1 |");
  });
});
