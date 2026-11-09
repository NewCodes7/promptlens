import { commitInfo, git, readNote, revList } from "./git.js";
import { renderFlow } from "./flow.js";
import type { Claim, CommitContext } from "./types.js";

export const REPORT_MARKER = "<!-- promptlens:report -->";

export interface CommitEntry {
  sha: string;
  subject: string;
  context: CommitContext | null;
}

/** PR-level synthesis — produced by an LLM when available, otherwise by `templateSynthesis`. */
export interface Synthesis {
  overview: string;
  why: string[];
  keyDecisions: Claim[];
  reviewFocus: { file?: string; text: string }[];
  openQuestions: string[];
  /** Whole-request outcomes for the prompt flow, by request index (LLM only). */
  turnOutcomes?: (string | undefined)[];
  generatedBy: string;
}

export function parseContext(note: string | null): CommitContext | null {
  if (!note) return null;
  try {
    const c = JSON.parse(note);
    return c && c.version === 1 ? (c as CommitContext) : null;
  } catch {
    return null;
  }
}

export function collectCommits(base: string, head: string, cwd?: string): { entries: CommitEntry[]; diffStat: string } {
  const mergeBase = git(["merge-base", base, head], { cwd, allowFail: true }) || base;
  const entries = revList(`${mergeBase}..${head}`, cwd).map((sha) => ({
    sha,
    subject: commitInfo(sha, cwd).subject,
    context: parseContext(readNote(sha, cwd)),
  }));
  const diffStat = git(["diff", "--stat", mergeBase, head], { cwd, allowFail: true });
  return { entries, diffStat };
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** No-LLM synthesis: stitch the per-commit contexts together. */
export function templateSynthesis(entries: CommitEntry[]): Synthesis {
  const ctx = entries.map((e) => e.context).filter((c): c is CommitContext => c !== null);
  const verifiedFiles = new Set<string>();
  const aiFiles = dedupe(
    ctx.flatMap((c) => c.files.filter((f) => f.aiEdited).map((f) => f.path)),
    (f) => f,
  );
  for (const c of ctx) if (c.verification.length) c.files.forEach((f) => verifiedFiles.add(f.path));
  const missing = entries.filter((e) => !e.context);
  const intents = dedupe(ctx.map((c) => c.intent.text.replace(/\s+/g, " ").trim()), (t) => t);
  return {
    overview: ctx.length
      ? `${ctx.length} commit(s) with AI context across ${new Set(ctx.flatMap((c) => c.sessionIds)).size} session(s). Main request: ${intents[0]}`
      : "No AI work context was recorded for the commits in this PR.",
    why: intents,
    keyDecisions: dedupe(ctx.flatMap((c) => c.decisions), (d) => d.text).slice(0, 8),
    reviewFocus: aiFiles
      .filter((f) => !verifiedFiles.has(f))
      .slice(0, 6)
      .map((file) => ({ file, text: "AI-edited with no recorded verification in its commit." })),
    openQuestions: missing.map((e) => `\`${e.sha.slice(0, 7)}\` ${e.subject} has no AI context (manual commit, or capture not installed).`),
    generatedBy: "template",
  };
}

function esc(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Single-line, escaped text for list items, headings and table cells. */
function line(text: string): string {
  return esc(text.replace(/\s+/g, " ").trim());
}

function quote(text: string): string {
  return esc(text)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

const claim = (c: Claim) => `${line(c.text)}${c.inferred ? " _(inferred)_" : ""}`;

function commitDetails(e: CommitEntry): string {
  const short = e.sha.slice(0, 7);
  const c = e.context;
  if (!c) {
    return `<details><summary><code>${short}</code> ${line(e.subject)} — <i>no AI context</i></summary>\n\nNo PromptLens context recorded for this commit.\n\n</details>`;
  }
  const meta = c.stats.sessions
    ? `${c.stats.sessions} AI session${c.stats.sessions > 1 ? "s" : ""} · ${c.stats.prompts} prompt${c.stats.prompts === 1 ? "" : "s"}`
    : "no AI session";
  const out: string[] = [`<details><summary><code>${short}</code> ${line(e.subject)} — ${meta}</summary>`, ""];
  out.push(`**Intent:** ${claim(c.intent)}`, "");
  if (c.keyPrompts.length) {
    out.push("**Key prompts**", "");
    for (const p of c.keyPrompts) out.push(quote(p.text), "", `<sub>↳ ${line(p.why)}</sub>`, "");
  }
  if (c.aiWork.length) out.push("**What the AI did**", ...c.aiWork.map((w) => `- ${line(w)}`), "");
  if (c.decisions.length) out.push("**Decisions**", ...c.decisions.map((d) => `- ${claim(d)}`), "");
  out.push(
    "**Verification**",
    ...(c.verification.length ? c.verification.map((v) => `- ✅ ${claim(v)}`) : ["- ⚠️ None recorded"]),
    "",
  );
  out.push("</details>");
  return out.join("\n");
}

export function renderReport(entries: CommitEntry[], syn: Synthesis, opts: { now?: Date } = {}): string {
  const ctx = entries.map((e) => e.context).filter((c): c is CommitContext => c !== null);
  const sessions = new Set(ctx.flatMap((c) => c.sessionIds));
  const prompts = ctx.reduce((n, c) => n + c.stats.prompts, 0);
  const files = new Map<string, boolean>();
  for (const c of ctx) for (const f of c.files) files.set(f.path, (files.get(f.path) ?? false) || f.aiEdited);
  const aiFiles = [...files.values()].filter(Boolean).length;

  const out: string[] = [REPORT_MARKER, "## 🔍 PromptLens — AI work context for this PR", ""];
  out.push(`> ${line(syn.overview)}`, "");
  out.push(
    "| Commits | With AI context | AI sessions | Prompts | AI-edited files |",
    "|:-:|:-:|:-:|:-:|:-:|",
    `| ${entries.length} | ${ctx.length} / ${entries.length} | ${sessions.size} | ${prompts} | ${aiFiles} / ${files.size} |`,
    "",
  );
  const flow = renderFlow(entries, undefined, syn.turnOutcomes);
  if (flow) out.push("### 🧭 How this PR was built — prompt by prompt", "", flow, "");
  if (syn.why.length) out.push("### Why these changes", ...syn.why.map((w) => `- ${line(w)}`), "");
  if (syn.keyDecisions.length) out.push("### Key decisions", ...syn.keyDecisions.map((d) => `- ${claim(d)}`), "");
  if (syn.reviewFocus.length)
    out.push(
      "### Where to focus your review",
      ...syn.reviewFocus.map((f) => `- ${f.file ? `\`${line(f.file)}\` — ` : ""}${line(f.text)}`),
      "",
    );
  if (syn.openQuestions.length) out.push("### Open questions", ...syn.openQuestions.map((q) => `- ${line(q)}`), "");
  out.push("### Commit timeline", "", ...entries.map(commitDetails).flatMap((d) => [d, ""]));
  const now = (opts.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  out.push(
    "---",
    `<sub>Generated by <b>PromptLens</b> from Commit Context notes (<code>refs/notes/promptlens</code>). Prompts are quoted selectively and redacted for secrets. Items marked <i>(inferred)</i> are model guesses. Synthesis: ${esc(syn.generatedBy)} · updated ${now}</sub>`,
  );
  return out.join("\n");
}
