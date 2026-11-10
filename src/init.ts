import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NOTES_REF, git, gitDir, repoRoot } from "./git.js";
import { type PackageInfo, pkg } from "./pkg.js";

const HOOK_TAG = "# promptlens";

/**
 * The command the generated workflow runs. It pins the exact version that ran `init`:
 * an unpinned `npx <name>@latest` would hand `contents: write` and the OpenAI key to
 * whatever is published next under that name.
 */
export function defaultWorkflowRun(info: PackageInfo = pkg): string {
  return `npx --yes ${info.name}@${info.version} pr-report --post`;
}

export function workflowYaml(run: string): string {
  return `name: PromptLens

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write # commits .promptlens/PR-<n>.md for line comments
  pull-requests: write

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ github.event.pull_request.head.sha }}
      - name: Fetch Commit Context notes
        run: git fetch origin "+${NOTES_REF}:${NOTES_REF}" || echo "no PromptLens notes yet"
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Post PromptLens report
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
        run: ${run}
`;
}

/** npx runs packages from a cache that npm may prune, which would leave the hooks pointing at nothing. */
export function isEphemeralCli(cli: string): boolean {
  return /[\\/]_npx[\\/]/.test(cli);
}

function hookScript(cli: string, cmd: string): string {
  return `${HOOK_TAG}\nnode "${cli}" ${cmd} || true\n`;
}

function installHook(hooksDir: string, name: string, body: string): "installed" | "appended" | "present" {
  const file = path.join(hooksDir, name);
  if (existsSync(file)) {
    const cur = readFileSync(file, "utf8");
    if (cur.includes(HOOK_TAG)) return "present";
    writeFileSync(file, cur.replace(/\s*$/, "\n\n") + body);
    chmodSync(file, 0o755);
    return "appended";
  }
  writeFileSync(file, `#!/bin/sh\n${body}`);
  chmodSync(file, 0o755);
  return "installed";
}

export interface InitOptions {
  cli: string;
  workflow: boolean;
  /** Workflow command override (e.g. build PromptLens from the repo itself instead of npx). Defaults to {@link defaultWorkflowRun}. */
  workflowRun?: string;
  cwd?: string;
}

/** One-time setup: hooks to capture & sync, notes config, and the PR workflow. */
export function init(opts: InitOptions): string[] {
  const log: string[] = [];
  const root = repoRoot(opts.cwd);
  const hooksPath = git(["config", "core.hooksPath"], { cwd: opts.cwd, allowFail: true });
  const hooksDir = hooksPath ? path.resolve(root, hooksPath) : path.join(gitDir(opts.cwd), "hooks");
  mkdirSync(hooksDir, { recursive: true });

  log.push(`post-commit hook: ${installHook(hooksDir, "post-commit", hookScript(opts.cli, "capture HEAD"))}`);
  log.push(`pre-push hook: ${installHook(hooksDir, "pre-push", hookScript(opts.cli, 'sync "$1"'))}`);
  if (isEphemeralCli(opts.cli)) {
    log.push(
      `warning: the hooks point into the npx cache (${opts.cli}), which npm may delete. Run \`npm install -g ${pkg.name}\`, delete the promptlens lines from .git/hooks/post-commit and pre-push, then run \`promptlens init\` again.`,
    );
  }

  // Keep notes attached when commits are amended or rebased.
  git(["config", "notes.rewriteRef", NOTES_REF], { cwd: opts.cwd });
  git(["config", "notes.rewrite.amend", "true"], { cwd: opts.cwd });
  git(["config", "notes.rewrite.rebase", "true"], { cwd: opts.cwd });
  // Fetch teammates' Commit Context on every fetch.
  const fetches = git(["config", "--get-all", "remote.origin.fetch"], { cwd: opts.cwd, allowFail: true });
  if (fetches && !fetches.includes(NOTES_REF)) {
    git(["config", "--add", "remote.origin.fetch", `+${NOTES_REF}:${NOTES_REF}`], { cwd: opts.cwd });
  }
  log.push(`git config: notes.rewriteRef=${NOTES_REF}, notes fetch refspec`);

  if (opts.workflow) {
    const wf = path.join(root, ".github", "workflows", "promptlens.yml");
    if (existsSync(wf)) log.push(`workflow: exists (${path.relative(root, wf)})`);
    else {
      mkdirSync(path.dirname(wf), { recursive: true });
      writeFileSync(wf, workflowYaml(opts.workflowRun ?? defaultWorkflowRun()));
      log.push(`workflow: created ${path.relative(root, wf)} — add an OPENAI_API_KEY secret for LLM synthesis`);
    }
  }
  return log;
}
