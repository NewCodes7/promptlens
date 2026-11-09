import { execFileSync } from "node:child_process";

export function git(args: string[], opts: { cwd?: string; input?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync("git", args, {
      cwd: opts.cwd,
      input: opts.input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trimEnd();
  } catch (err) {
    if (opts.allowFail) return "";
    throw err;
  }
}

export const NOTES_REF = "refs/notes/promptlens";

export function repoRoot(cwd?: string): string {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}

export function gitDir(cwd?: string): string {
  return git(["rev-parse", "--absolute-git-dir"], { cwd });
}

export function resolveSha(rev: string, cwd?: string): string {
  return git(["rev-parse", rev], { cwd });
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  committedAt: string;
  subject: string;
}

export function commitInfo(rev: string, cwd?: string): CommitInfo {
  const out = git(["show", "-s", "--format=%H%n%P%n%cI%n%s", rev], { cwd });
  const [sha, parents, committedAt, ...subject] = out.split("\n");
  return {
    sha,
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    committedAt,
    subject: subject.join("\n"),
  };
}

export function filesChanged(sha: string, cwd?: string): string[] {
  const out = git(["show", "--name-only", "--format=", "--no-renames", sha], { cwd });
  return out.split("\n").filter(Boolean);
}

export function diffStat(sha: string, cwd?: string): string {
  return git(["show", "--stat", "--format=", sha], { cwd });
}

export function commitPatch(sha: string, maxChars: number, cwd?: string): string {
  const out = git(["show", "--format=", "--unified=2", sha], { cwd });
  return out.length > maxChars ? out.slice(0, maxChars) + "\n... (diff truncated)" : out;
}

export function readNote(sha: string, cwd?: string): string | null {
  const out = git(["notes", `--ref=${NOTES_REF}`, "show", sha], { cwd, allowFail: true });
  return out || null;
}

export function writeNote(sha: string, content: string, cwd?: string): void {
  git(["notes", `--ref=${NOTES_REF}`, "add", "-f", "-F", "-", sha], { cwd, input: content });
}

export function revList(range: string, cwd?: string): string[] {
  return git(["rev-list", "--reverse", "--no-merges", range], { cwd, allowFail: true })
    .split("\n")
    .filter(Boolean);
}
