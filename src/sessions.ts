import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Marker placed at the start of PromptLens' own `claude -p` prompts so they are never captured. */
export const SELF_MARKER = "PROMPTLENS_SUMMARIZE";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Prompts that are harness noise rather than something the developer typed. */
const NOISE_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<local-command",
  "<system-reminder>",
  "<bash-input>",
  "<bash-stdout>",
  "<task-notification>",
  "Caveat:",
  "[Request interrupted",
  SELF_MARKER,
];

export type SessionEvent =
  | { kind: "prompt"; ts: string; sessionId: string; cwd: string; text: string }
  | { kind: "edit"; ts: string; sessionId: string; cwd: string; tool: string; file: string }
  | { kind: "command"; ts: string; sessionId: string; cwd: string; command: string; description?: string }
  | { kind: "decision"; ts: string; sessionId: string; cwd: string; question: string; answer: string }
  | { kind: "note"; ts: string; sessionId: string; cwd: string; text: string };

export function claudeProjectsDir(): string {
  if (process.env.PROMPTLENS_CLAUDE_PROJECTS) return process.env.PROMPTLENS_CLAUDE_PROJECTS;
  const base = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
  return path.join(base, "projects");
}

/** Claude Code stores sessions under a directory named after the cwd with non-alphanumerics replaced by '-'. */
export function projectDirName(absPath: string): string {
  return absPath.replace(/[^A-Za-z0-9]/g, "-");
}

/** Session log files that may belong to this repo (including worktrees and subdirectories). */
export function findSessionFiles(root: string, modifiedSince?: Date): string[] {
  const dir = claudeProjectsDir();
  if (!existsSync(dir)) return [];
  const prefix = projectDirName(root);
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry !== prefix && !entry.startsWith(`${prefix}-`)) continue;
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(full, f);
      if (modifiedSince && statSync(fp).mtime < modifiedSince) continue;
      files.push(fp);
    }
  }
  return files;
}

function isNoise(text: string): boolean {
  const t = text.trimStart();
  return t.length === 0 || NOISE_PREFIXES.some((p) => t.startsWith(p));
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((b) => b?.type === "tool_result")) return null;
  const parts = content.filter((b) => b?.type === "text").map((b) => String(b.text));
  return parts.length ? parts.join("\n") : null;
}

function toolResultText(block: { content?: unknown }): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => (x?.type === "text" ? String(x.text) : "")).join("\n");
  return "";
}

/** Parse `"question"="answer"` pairs from an AskUserQuestion tool result. */
export function parseAnswers(result: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  const re = /"((?:[^"\\]|\\.)+)"="((?:[^"\\]|\\.)*)"/g;
  for (const [, question, answer] of result.matchAll(re)) out.push({ question, answer });
  return out;
}

/** Parse one Claude Code session log (.jsonl) into a flat list of events. */
export function parseSessionLog(raw: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const askIds = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.isSidechain || (d.type !== "user" && d.type !== "assistant")) continue;
    const base = { ts: String(d.timestamp ?? ""), sessionId: String(d.sessionId ?? ""), cwd: String(d.cwd ?? "") };
    const content = d.message?.content;

    if (d.type === "user") {
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "tool_result" && askIds.has(b.tool_use_id)) {
            for (const qa of parseAnswers(toolResultText(b))) events.push({ kind: "decision", ...base, ...qa });
          }
        }
      }
      if (d.isMeta) continue;
      // Strip harness wrappers around pasted text so only what the developer wrote remains.
      const text = textOf(content)
        ?.replace(/<\/?pasted_content[^>]*>/g, "")
        .trim();
      if (text && !isNoise(text)) events.push({ kind: "prompt", ...base, text });
      continue;
    }

    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        events.push({ kind: "note", ...base, text: b.text.trim() });
      } else if (b?.type === "tool_use") {
        const input = b.input ?? {};
        if (EDIT_TOOLS.has(b.name)) {
          const file = input.file_path ?? input.notebook_path;
          if (file) events.push({ kind: "edit", ...base, tool: b.name, file: String(file) });
        } else if (b.name === "Bash" && input.command) {
          events.push({ kind: "command", ...base, command: String(input.command), description: input.description });
        } else if (b.name === "AskUserQuestion") {
          askIds.add(b.id);
        }
      }
    }
  }
  return events;
}

export function loadEvents(root: string, modifiedSince?: Date): SessionEvent[] {
  return findSessionFiles(root, modifiedSince).flatMap((f) => parseSessionLog(readFileSync(f, "utf8")));
}
