import { NOTES_REF } from "./git.js";
import { pkg } from "./pkg.js";

/** Every subcommand the CLI dispatches. Anything else is an error, not a request for help. */
export const COMMANDS = ["init", "capture", "summarize", "sync", "show", "report", "pr-report"] as const;

/** Spellings a typo is compared against when suggesting a command. */
const CANDIDATES: readonly string[] = [...COMMANDS, "--version", "--help"];

export function usage(): string {
  return `promptlens ${pkg.version} — AI work context for code review

Usage:
  promptlens init [--no-workflow] [--workflow-run CMD]
                                      Install git hooks, notes config and the PR workflow
                                      (the workflow pins ${pkg.name}@${pkg.version})
  promptlens capture [rev] [--sync]   (post-commit) link AI sessions to a commit
  promptlens summarize [rev] [--force] Write the Commit Context note for a commit
  promptlens sync [remote]            (pre-push) ensure contexts and push ${NOTES_REF}
  promptlens show [rev]               Print a commit's Commit Context
  promptlens report [--base B] [--head H]   Preview the PR report locally
  promptlens report --file [--pr N]   Preview the line-commentable review file
  promptlens pr-report --post         (GitHub Actions) commit .promptlens/PR-<n>.md and post/update the PR comment
                                      (--no-review-file: comment only)
  promptlens --version                Print the installed version
  promptlens --help                   Print this help`;
}

/** Edit distance between two short strings (insertions, deletions and substitutions). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, substitute));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** The closest known command within two edits, so a typo gets a hint instead of a bare error. */
export function suggestCommand(input: string): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const name of CANDIDATES) {
    const d = distance(input.toLowerCase(), name);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

/** The error line for a command PromptLens doesn't have. */
export function unknownCommand(input: string): string {
  const hint = suggestCommand(input);
  return `[promptlens] unknown command: ${input}${hint ? ` (did you mean \`promptlens ${hint}\`?)` : ""}`;
}
