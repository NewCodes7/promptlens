import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { commitInfo, filesChanged, gitDir, repoRoot } from "./git.js";
import { loadEvents, type SessionEvent } from "./sessions.js";
import type { RawCapture, SessionSlice } from "./types.js";

/** Grace period after the commit timestamp (commit times have 1s precision; hooks run slightly later). */
const SLACK_MS = 5_000;
/** For a root commit there is no parent time; look back this far. */
const ROOT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export function toRepoPath(root: string, file: string): string {
  if (!path.isAbsolute(file)) return file.replace(/^\.\//, "");
  // Claude Code worktrees live inside the repo (.claude/worktrees/<name>/...) — map back to repo paths.
  const wt = file.match(/\/\.claude\/worktrees\/[^/]+\/(.+)$/);
  if (wt) return wt[1];
  const rel = path.relative(root, file);
  return rel.startsWith("..") ? file : rel;
}

export interface CaptureInput {
  root: string;
  sha: string;
  subject: string;
  from: string | null;
  to: string;
  filesChanged: string[];
}

/**
 * Link AI sessions to a commit.
 * A session belongs to the commit when, inside the commit window (parent commit → this commit),
 * it edited at least one file that the commit changed. Everything that session did in the window
 * (prompts, decisions, commands) becomes part of the commit's capture.
 * Several sessions can contribute to one commit; each becomes its own slice.
 */
export function buildCapture(events: SessionEvent[], input: CaptureInput): RawCapture {
  const toMs = Date.parse(input.to) + SLACK_MS;
  const fromMs = input.from ? Date.parse(input.from) : Date.parse(input.to) - ROOT_LOOKBACK_MS;
  const changed = new Set(input.filesChanged);

  const bySession = new Map<string, SessionEvent[]>();
  const lastPromptBefore = new Map<string, SessionEvent>();
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (e.kind === "prompt" && t <= fromMs) {
      const prev = lastPromptBefore.get(e.sessionId);
      if (!prev || Date.parse(prev.ts) < t) lastPromptBefore.set(e.sessionId, e);
    }
    if (!(t > fromMs && t <= toMs)) continue;
    const list = bySession.get(e.sessionId) ?? [];
    list.push(e);
    bySession.set(e.sessionId, list);
  }

  const sessions: SessionSlice[] = [];
  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const slice: SessionSlice = {
      sessionId,
      agent: "claude-code",
      prompts: [],
      edits: [],
      commands: [],
      decisions: [],
      assistantNotes: [],
    };
    for (const e of list) {
      if (e.kind === "prompt") slice.prompts.push({ ts: e.ts, text: e.text });
      else if (e.kind === "edit") slice.edits.push({ ts: e.ts, tool: e.tool, file: toRepoPath(input.root, e.file) });
      else if (e.kind === "command") slice.commands.push({ ts: e.ts, command: e.command, description: e.description });
      else if (e.kind === "decision") slice.decisions.push({ ts: e.ts, question: e.question, answer: e.answer });
      else if (e.kind === "note") slice.assistantNotes.push(e.text);
    }
    // The agent kept working on an earlier instruction: carry that instruction forward as context.
    const carried = lastPromptBefore.get(sessionId);
    if (slice.prompts.length === 0 && carried?.kind === "prompt") {
      slice.prompts.push({ ts: carried.ts, text: carried.text, carried: true });
    }
    if (slice.edits.some((ed) => changed.has(ed.file))) sessions.push(slice);
  }
  sessions.sort((a, b) => (a.prompts[0]?.ts ?? "").localeCompare(b.prompts[0]?.ts ?? ""));

  return {
    version: 1,
    sha: input.sha,
    subject: input.subject,
    window: { from: input.from, to: input.to },
    filesChanged: input.filesChanged,
    sessions,
  };
}

export function rawDir(cwd?: string): string {
  return path.join(gitDir(cwd), "promptlens", "raw");
}

export function rawPath(sha: string, cwd?: string): string {
  return path.join(rawDir(cwd), `${sha}.json`);
}

export function readRaw(sha: string, cwd?: string): RawCapture | null {
  const p = rawPath(sha, cwd);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as RawCapture) : null;
}

/** Capture a commit from local Claude Code session logs and store the raw result privately in .git/. */
export function captureCommit(rev = "HEAD", cwd?: string): RawCapture {
  const root = repoRoot(cwd);
  const info = commitInfo(rev, cwd);
  const parent = info.parents[0] ? commitInfo(info.parents[0], cwd) : null;
  const from = parent?.committedAt ?? null;
  const since = new Date((from ? Date.parse(from) : Date.parse(info.committedAt) - ROOT_LOOKBACK_MS) - 60_000);
  const capture = buildCapture(loadEvents(root, since), {
    root,
    sha: info.sha,
    subject: info.subject,
    from,
    to: info.committedAt,
    filesChanged: filesChanged(info.sha, cwd),
  });
  mkdirSync(rawDir(cwd), { recursive: true });
  writeFileSync(rawPath(info.sha, cwd), JSON.stringify(capture, null, 2));
  return capture;
}
