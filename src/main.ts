import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommit, readRaw } from "./capture.js";
import { errorMessage } from "./errors.js";
import { git, gitDir, NOTES_REF, readNote, resolveSha, revList, writeNote } from "./git.js";
import { type PullRequestEvent, readPullRequestEvent, upsertComment, upsertFile } from "./github.js";
import { init } from "./init.js";
import { synthesize, translatePrompts } from "./openai.js";
import { pkg } from "./pkg.js";
import { collectCommits, renderReport, translatableTexts } from "./report.js";
import { renderReviewFile, reviewFilePath, reviewFileUrl } from "./review.js";
import { summarize } from "./summarize.js";
import { unknownCommand, usage } from "./usage.js";

/** The installed entry point (dist/cli.js): git hooks and the background summarizer run it by absolute path. */
const CLI = (() => {
  const entry = fileURLToPath(new URL("./cli.js", import.meta.url));
  try {
    return realpathSync(entry);
  } catch {
    return entry; // under tests the sources run from src/, where no cli.js is built
  }
})();
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

/** A `--key value` option; a bare `--key` (no value) counts as absent rather than the string "true". */
function stringOpt(opt: Record<string, string | true>, key: string): string | undefined {
  const v = opt[key];
  return typeof v === "string" ? v : undefined;
}

function pullRequestEvent(eventPath: string | undefined): PullRequestEvent {
  return eventPath ? readPullRequestEvent(JSON.parse(readFileSync(eventPath, "utf8"))) : {};
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

/** The pre-push hook's stdin, one line per pushed ref; empty when `sync` is run by hand. */
function stdinText(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Run one CLI command. `readStdin` is injectable so tests can play the pre-push hook. */
export async function main(argv: string[], readStdin: () => string = stdinText): Promise<void> {
  const [cmd, ...rest] = argv;
  const { pos, opt } = flags(rest);

  switch (cmd) {
    case "--version":
    case "-v":
      console.log(pkg.version);
      return;

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
      const ranges = readStdin()
        .split("\n")
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length === 4 && !ZERO.test(p[1]))
        .map(([, localSha, , remoteSha]) => (ZERO.test(remoteSha) ? `${localSha} --not --remotes=${remote}` : `${remoteSha}..${localSha}`));
      const shas = ranges.length
        ? ranges.flatMap((r) =>
            r.includes("--not")
              ? git(["rev-list", ...r.split(" ")], { allowFail: true })
                  .split("\n")
                  .filter(Boolean)
              : revList(r),
          )
        : revList(`@{u}..HEAD`);
      let written = 0;
      for (const sha of shas) if ((await ensureContext(sha)) === "written") written++;
      try {
        pushNotes(remote);
        console.error(`[promptlens] synced Commit Context for ${shas.length} commit(s) (${written} new) → ${remote} ${NOTES_REF}`);
      } catch (err) {
        console.error(`[promptlens] could not push notes: ${errorMessage(err)}`);
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
      const event = pullRequestEvent(process.env.GITHUB_EVENT_PATH);
      const base = stringOpt(opt, "base") ?? event.baseSha ?? "origin/main";
      const head = stringOpt(opt, "head") ?? event.headSha ?? "HEAD";
      const { entries, diffStat } = collectCommits(base, head);
      const pr = Number(stringOpt(opt, "pr") ?? event.number);
      if (opt.file) {
        // Local preview of the line-commentable review file.
        const translations = await translatePrompts(translatableTexts(entries));
        console.log(renderReviewFile(entries, pr || 0, { translations }));
        return;
      }
      const [synthesis, translations] = await Promise.all([synthesize(entries, diffStat), translatePrompts(translatableTexts(entries))]);
      if (!opt.post) {
        console.log(renderReport(entries, synthesis, { translations }));
        return;
      }
      const token = process.env.GITHUB_TOKEN;
      const repo = stringOpt(opt, "repo") ?? process.env.GITHUB_REPOSITORY;
      if (!token || !repo || !pr) throw new Error("--post needs GITHUB_TOKEN, a repo and a PR number");

      // 1) Commit the review file to the PR branch so reviewers can comment on individual lines.
      //    Fork PRs get a read-only token, so they keep the comment only.
      let reviewFile: { path: string; url: string } | undefined;
      const branch = stringOpt(opt, "branch") ?? event.headRef;
      const headRepo = event.headRepo ?? repo;
      if (opt["no-review-file"]) {
        /* opted out */
      } else if (!branch || headRepo !== repo) {
        console.log("PromptLens review file skipped: PR branch is in a fork (read-only token).");
      } else {
        const filePath = reviewFilePath(pr);
        try {
          const res = await upsertFile(
            token,
            repo,
            branch,
            filePath,
            renderReviewFile(entries, pr, { translations }),
            `chore(promptlens): update prompt flow review file for PR #${pr}`,
          );
          reviewFile = { path: filePath, url: reviewFileUrl(repo, pr, filePath) };
          console.log(`PromptLens review file ${res.action}: ${filePath}${res.sha ? ` (${res.sha.slice(0, 7)})` : ""}`);
        } catch (err) {
          console.error(`[promptlens] could not commit the review file (needs \`contents: write\`): ${errorMessage(err)}`);
        }
      }

      // 2) The conversation comment, as before, now linking to the review file.
      const res = await upsertComment(token, repo, pr, renderReport(entries, synthesis, { translations, reviewFile }));
      console.log(`PromptLens report ${res.action}: ${res.url}`);
      return;
    }

    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(usage());
      return;

    default:
      console.error(`${unknownCommand(cmd)}\n`);
      console.error(usage());
      process.exitCode = 1;
  }
}
