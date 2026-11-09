import { redact, truncate } from "./redact.js";
import type { Phase, RawCapture } from "./types.js";

export const MAX_PHASES_PER_COMMIT = 4;
const MAX_ITEMS = 160;
const VERIFY_RE = /\b(test|tests|vitest|jest|pytest|mocha|tsc|typecheck|lint|eslint|coverage|go test|cargo (?:test|check))\b/i;
const SHIP_RE = /\b(git push|gh pr|gh release|npm publish|deploy)\b/i;

/** One step of the commit's conversation, in time order across sessions. */
export interface TimelineItem {
  i: number;
  ts: string;
  sessionId: string;
  kind: "prompt" | "decision" | "edit" | "command" | "note";
  text: string;
  promptIndex?: number;
  files?: string[];
}

/** Flatten a capture into a numbered, time-ordered timeline; consecutive edits collapse into one step. */
export function buildTimeline(raw: RawCapture): TimelineItem[] {
  const items: Omit<TimelineItem, "i">[] = [];
  let pIndex = 0;
  for (const s of raw.sessions) {
    for (const p of s.prompts) items.push({ ts: p.ts, sessionId: s.sessionId, kind: "prompt", text: p.text, promptIndex: pIndex++ });
    for (const d of s.decisions) items.push({ ts: d.ts, sessionId: s.sessionId, kind: "decision", text: `${d.question} → ${d.answer}` });
    for (const e of s.edits) items.push({ ts: e.ts, sessionId: s.sessionId, kind: "edit", text: e.file, files: [e.file] });
    for (const c of s.commands) items.push({ ts: c.ts, sessionId: s.sessionId, kind: "command", text: c.description ? `${c.description}: ${c.command}` : c.command });
  }
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  const merged: Omit<TimelineItem, "i">[] = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (it.kind === "edit" && last?.kind === "edit" && last.sessionId === it.sessionId) {
      if (!last.files!.includes(it.text)) last.files!.push(it.text);
      last.text = last.files!.join(", ");
    } else merged.push({ ...it, files: it.files ? [...it.files] : undefined });
  }
  return merged.slice(0, MAX_ITEMS).map((it, i) => ({ ...it, i }));
}

type Cls = "plan" | "build" | "fix" | "verify" | "docs" | "ship";

function classify(it: TimelineItem): Cls | null {
  if (it.kind === "decision") return "plan";
  if (it.kind === "command") return SHIP_RE.test(it.text) ? "ship" : VERIFY_RE.test(it.text) ? "verify" : null;
  if (it.kind === "edit") {
    const f = it.files ?? [];
    if (f.length && f.every((x) => /\.(md|mdx|txt)$/i.test(x))) return "docs";
    if (f.length && f.every((x) => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\./.test(x))) return "verify";
    return "build";
  }
  return null;
}

/** Build a phase from a contiguous timeline range. */
export function phaseFromRange(
  timeline: TimelineItem[],
  from: number,
  to: number,
  type: string,
  label: string,
  promptText: string | null,
  decisions: { text: string; why: string }[],
): Phase {
  const range = timeline.filter((t) => t.i >= from && t.i <= to);
  const files = new Set(range.flatMap((t) => t.files ?? []));
  return {
    type: type.toLowerCase().trim() || "build",
    label: truncate(redact(label), 80),
    prompt: promptText ? truncate(redact(promptText), 300) : null,
    decisions: decisions.map((d) => ({ text: truncate(redact(d.text), 200), why: truncate(redact(d.why), 200) })),
    prompts: range.filter((t) => t.kind === "prompt").length,
    files: files.size,
    commands: range.filter((t) => t.kind === "command").length,
    sessionId: range[0]?.sessionId ?? "",
  };
}

const TYPE_LABEL: Record<Cls, string> = {
  plan: "Clarify requirements",
  build: "Implement changes",
  fix: "Fix issues",
  verify: "Test and verify",
  docs: "Write docs",
  ship: "Ship",
};

/** Deterministic grouping used when no LLM is available. */
export function heuristicPhases(raw: RawCapture): Phase[] {
  const tl = buildTimeline(raw);
  if (!tl.length) return [];
  const prompts = raw.sessions.flatMap((s) => s.prompts);
  // Segment at each prompt and whenever the activity class changes.
  const raw_segs: { from: number; to: number; cls: Cls | null; prompt: string | null }[] = [];
  for (const it of tl) {
    const cls = classify(it);
    const cur = raw_segs[raw_segs.length - 1];
    if (it.kind === "prompt") raw_segs.push({ from: it.i, to: it.i, cls: null, prompt: prompts[it.promptIndex!]?.text ?? it.text });
    else if (!cur) raw_segs.push({ from: it.i, to: it.i, cls, prompt: null });
    else if (cls && cur.cls === null) {
      cur.cls = cls;
      cur.to = it.i;
    } else if (cls && cls !== cur.cls) raw_segs.push({ from: it.i, to: it.i, cls, prompt: null });
    else cur.to = it.i;
  }
  const segs = raw_segs.map((s) => ({ ...s, cls: s.cls ?? ("build" as Cls) }));
  // Merge neighbours of the same class, then the smallest pairs until under the cap.
  const merged: typeof segs = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.cls === s.cls && !s.prompt) last.to = s.to;
    else merged.push({ ...s });
  }
  while (merged.length > MAX_PHASES_PER_COMMIT) {
    let best = 0;
    for (let k = 1; k < merged.length - 1; k++) if (merged[k].to - merged[k].from + merged[k + 1].to - merged[k + 1].from < merged[best].to - merged[best].from + merged[best + 1].to - merged[best + 1].from) best = k;
    merged[best] = { ...merged[best], to: merged[best + 1].to, prompt: merged[best].prompt ?? merged[best + 1].prompt };
    merged.splice(best + 1, 1);
  }
  return merged.map((s) => {
    const decisions = tl.filter((t) => t.i >= s.from && t.i <= s.to && t.kind === "decision").map((t) => ({ text: t.text, why: "Developer's answer when the agent asked." }));
    const label = s.prompt ? truncate(redact(s.prompt).replace(/\s+/g, " "), 60) : TYPE_LABEL[s.cls];
    return phaseFromRange(tl, s.from, s.to, s.cls, label, s.prompt, decisions);
  });
}

/** Turn the model's phase grouping into Phases; prompts are quoted from the capture by index. */
export function phasesFromModel(raw: RawCapture, model: unknown): Phase[] {
  const tl = buildTimeline(raw);
  const prompts = raw.sessions.flatMap((s) => s.prompts);
  if (!Array.isArray(model) || !tl.length) return heuristicPhases(raw);
  const out: Phase[] = [];
  for (const m of model.slice(0, MAX_PHASES_PER_COMMIT)) {
    const from = Number(m?.from);
    const to = Number(m?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || typeof m?.label !== "string") continue;
    const pi = m.promptIndex === null || m.promptIndex === undefined ? null : Number(m.promptIndex);
    const promptText = pi !== null && prompts[pi] ? prompts[pi].text : null;
    const decisions = Array.isArray(m.decisions)
      ? m.decisions.filter((d: any) => typeof d?.text === "string").map((d: any) => ({ text: d.text, why: String(d.why ?? "") }))
      : [];
    out.push(phaseFromRange(tl, from, to, String(m.type ?? "build"), m.label, promptText, decisions));
  }
  return out.length ? out : heuristicPhases(raw);
}

/** Timeline section of the summarization prompt. */
export function timelineForPrompt(raw: RawCapture): string {
  return buildTimeline(raw)
    .map((t) => {
      const tag = t.kind === "prompt" ? `PROMPT[${t.promptIndex}]` : t.kind.toUpperCase();
      return `T${t.i} ${tag}: ${truncate(t.text.replace(/\s+/g, " "), t.kind === "prompt" ? 400 : 160)}`;
    })
    .join("\n");
}
