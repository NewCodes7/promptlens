#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommit, readRaw } from "./capture.js";
import { NOTES_REF, git, gitDir, readNote, resolveSha, revList, writeNote } from "./git.js";
import { upsertComment } from "./github.js";
import { init } from "./init.js";
import { synthesize } from "./openai.js";
import { collectCommits, renderReport } from "./report.js";
import { summarize } from "./summarize.js";

const CLI = realpathSync(fileURLToPath(import.meta.url));
const ZERO = /^0+$/;

function flags(argv: string[]): { pos: string[]; opt: Record<string, string | true> } {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) opt[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

function logFile(): string {
  const dir = path.join(gitDir(), "promptlens");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "promptlens.log");
}

function log(msg: string) {
  appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`);
}

/** Capture (or reuse) the raw record and write the Commit Context note. */
async function ensureContext(sha: string): Promise<"exists" | "written"> {
  if (readNote(sha)) return "exists";
  const raw = readRaw(sha) ?? captureCommit(sha);
  const ctx = await summarize(raw);
  writeNote(sha, JSON.stringify(ctx, null, 2));
  log(`context ${sha.slice(0, 7)} sessions=${ctx.stats.sessions} prompts=${ctx.stats.prompts} by=${ctx.generatedBy}`);
  return "written";
}

function pushNotes(remote: string) {
  const push = () => git(["push", "--no-verify", "--quiet", remote, `${NOTES_REF}:${NOTES_REF}`]);
  try {
    push();
  } catch {
    // Remote notes moved (e.g. teammate pushed): merge theirs, keep ours on conflict, retry once.
    git(["fetch", "--quiet", remote, `+${NOTES_REF}:refs/notes/promptlens-remote`], { allowFail: true });
    git(["notes", `--ref=${NOTES_REF}`, "merge", "-s", "ours", "refs/notes/promptlens-remote"], { allowFail: true });
    push();
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = flags(rest);

  switch (cmd) {
    case "init": {
      const lines = init({
        cli: CLI,
        workflow: !opt["no-workflow"],
        workflowRun: typeof opt["workflow-run"] === "string" ? opt["workflow-run"] : undefined,
      });
      console.log(["PromptLens initialized:", ...lines.map((l) => `  • ${l}`)].join("\n"));
      return;
    }

    case "capture": {
      // post-commit hook: fast, private capture now; LLM summary in the background.
      const raw = captureCommit(pos[0] ?? "HEAD");
      const prompts = raw.sessions.reduce((n, s) => n + s.prompts.length, 0);
      log(`capture ${raw.sha.slice(0, 7)} sessions=${raw.sessions.length} prompts=${prompts}`);
      if (opt.sync) {
        console.log(`${raw.sha.slice(0, 7)}: ${await ensureContext(raw.sha)}`);
      } else {
        const err = openSync(logFile(), "a");
        const child = spawn(process.execPath, [CLI, "summarize", raw.sha], { detached: true, stdio: ["ignore", "ignore", err] });
        child.unref();
      }
      console.log(`[promptlens] captured ${raw.sessions.length} AI session(s), ${prompts} prompt(s) for ${raw.sha.slice(0, 7)}`);
      return;
    }

    case "summarize": {
      const sha = resolveSha(pos[0] ?? "HEAD");
      if (opt.force) {
        git(["notes", `--ref=${NOTES_REF}`, "remove", "--ignore-missing", sha], { allowFail: true });
        captureCommit(sha);
      }
      console.log(`${sha.slice(0, 7)}: ${await ensureContext(sha)}`);
      return;
    }

    case "sync": {
      // pre-push hook: make sure every pushed commit has context, then push the notes ref first.
      if (process.env.PROMPTLENS_PUSHING) return;
      const remote = pos[0] ?? "origin";
      let stdin = "";
      try {
        stdin = readFileSync(0, "utf8");
      } catch {
        /* no stdin when run manually */
      }
      const ranges = stdin
        .split("\n")
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length === 4 && !ZERO.test(p[1]))
        .map(([, localSha, , remoteSha]) => (ZERO.test(remoteSha) ? `${localSha} --not --remotes=${remote}` : `${remoteSha}..${localSha}`));
      const shas = ranges.length
        ? ranges.flatMap((r) => (r.includes("--not") ? git(["rev-list", ...r.split(" ")], { allowFail: true }).split("\n").filter(Boolean) : revList(r)))
        : revList(`@{u}..HEAD`);
      let written = 0;
      for (const sha of shas) if ((await ensureContext(sha)) === "written") written++;
      try {
        pushNotes(remote);
        console.error(`[promptlens] synced Commit Context for ${shas.length} commit(s) (${written} new) → ${remote} ${NOTES_REF}`);
      } catch (err) {
        console.error(`[promptlens] could not push notes: ${(err as Error).message}`);
      }
      return;
    }

    case "show": {
      const note = readNote(resolveSha(pos[0] ?? "HEAD"));
      console.log(note ?? "No Commit Context for this commit.");
      return;
    }

    case "report":
    case "pr-report": {
      const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : null;
      const base = (opt.base as string) ?? event?.pull_request?.base?.sha ?? "origin/main";
      const head = (opt.head as string) ?? event?.pull_request?.head?.sha ?? "HEAD";
      const { entries, diffStat } = collectCommits(base, head);
      const synthesis = await synthesize(entries, diffStat);
      const body = renderReport(entries, synthesis);
      if (!opt.post) {
        console.log(body);
        return;
      }
      const token = process.env.GITHUB_TOKEN;
      const repo = (opt.repo as string) ?? process.env.GITHUB_REPOSITORY;
      const pr = Number(opt.pr ?? event?.pull_request?.number);
      if (!token || !repo || !pr) throw new Error("--post needs GITHUB_TOKEN, a repo and a PR number");
      const res = await upsertComment(token, repo, pr, body);
      console.log(`PromptLens report ${res.action}: ${res.url}`);
      return;
    }

    default:
      console.log(`promptlens — AI work context for code review

Usage:
  promptlens init [--no-workflow]     Install git hooks, notes config and the PR workflow
  promptlens capture [rev] [--sync]   (post-commit) link AI sessions to a commit
  promptlens summarize [rev] [--force] Write the Commit Context note for a commit
  promptlens sync [remote]            (pre-push) ensure contexts and push ${NOTES_REF}
  promptlens show [rev]               Print a commit's Commit Context
  promptlens report [--base B] [--head H]   Preview the PR report locally
  promptlens pr-report --post         (GitHub Actions) post/update the PR comment`);
  }
}

main().catch((err) => {
  console.error(`[promptlens] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
