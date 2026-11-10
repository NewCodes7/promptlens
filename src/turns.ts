import { redact, truncate } from "./redact.js";
import type { RawCapture, SessionSlice, Turn, TurnStep } from "./types.js";

const VERIFY_RE = /\b(test|tests|vitest|jest|pytest|mocha|tsc|typecheck|lint|eslint|coverage|go test|cargo (?:test|check))\b/i;
const SHIP_RE = /\b(git push|gh pr|gh release|npm publish|deploy)\b/i;
const INVESTIGATE_RE = /^\s*(cat|ls|grep|rg|find|head|tail|sed -n|git (log|show|status|diff)|gh (run|api|pr view))\b/;
/** Short follow-ups that continue the previous request rather than start a new one. */
const FOLLOW_UP_RE = /^(y|yes|yep|ok|okay|sure|go|go ahead|continue|do it|lgtm|네|넵|응|ㅇㅇ|좋아|진행|계속|고고)\b|[?？]\s*$/i;

interface PromptMeta {
  index: number;
  sessionId: string;
  ts: string;
  text: string;
  carried: boolean;
}

/** Every PromptMeta comes from one of `raw.sessions`, so a miss here is a programming error, not bad input. */
function sessionOf(raw: RawCapture, sessionId: string): SessionSlice {
  const session = raw.sessions.find((s) => s.sessionId === sessionId);
  if (!session) throw new Error(`capture has no session ${sessionId}`);
  return session;
}

export function promptList(raw: RawCapture): PromptMeta[] {
  let i = 0;
  return raw.sessions.flatMap((s) =>
    s.prompts.map((p) => ({ index: i++, sessionId: s.sessionId, ts: p.ts, text: p.text, carried: Boolean(p.carried) })),
  );
}

/** Numbered prompt list + per-prompt agent activity, for the summarization prompt. */
export function turnsForPrompt(raw: RawCapture): string {
  const prompts = promptList(raw);
  return prompts
    .map((p) => {
      const next = prompts.find((q) => q.sessionId === p.sessionId && q.ts > p.ts)?.ts;
      const s = sessionOf(raw, p.sessionId);
      const inRange = (ts: string) => ts >= p.ts && (!next || ts < next);
      const acts = [
        ...s.decisions
          .filter((d) => inRange(d.ts))
          .map((d) => ({ ts: d.ts, t: `ASKED ${truncate(d.question, 120)} → ${truncate(d.answer, 80)}` })),
        ...s.edits.filter((e) => inRange(e.ts)).map((e) => ({ ts: e.ts, t: `EDIT ${e.file}` })),
        ...s.commands.filter((c) => inRange(c.ts)).map((c) => ({ ts: c.ts, t: `RUN ${truncate(c.description ?? c.command, 120)}` })),
      ]
        .sort((a, b) => a.ts.localeCompare(b.ts))
        .map((a) => `    - ${a.t}`);
      const head = `PROMPT[${p.index}]${p.carried ? " (given before this commit; agent still working on it)" : ""}: ${truncate(p.text.replace(/\s+/g, " "), 600)}`;
      return [head, ...acts.slice(0, 40), acts.length > 40 ? `    - … ${acts.length - 40} more actions` : ""].filter(Boolean).join("\n");
    })
    .join("\n");
}

type Act = { ts: string; kind: "edit" | "command" | "decision"; text: string; file?: string };

function actsIn(s: SessionSlice, from: string, to: string | null): Act[] {
  const inRange = (ts: string) => ts >= from && (!to || ts < to);
  return [
    ...s.edits.filter((e) => inRange(e.ts)).map((e) => ({ ts: e.ts, kind: "edit" as const, text: e.file, file: e.file })),
    ...s.commands.filter((c) => inRange(c.ts)).map((c) => ({ ts: c.ts, kind: "command" as const, text: c.command })),
    ...s.decisions.filter((d) => inRange(d.ts)).map((d) => ({ ts: d.ts, kind: "decision" as const, text: `${d.question} → ${d.answer}` })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
}

function classify(a: Act): string | null {
  if (a.kind === "decision") return "plan";
  if (a.kind === "command")
    return SHIP_RE.test(a.text) ? "ship" : VERIFY_RE.test(a.text) ? "verify" : INVESTIGATE_RE.test(a.text) ? "investigate" : null;
  const f = a.file ?? "";
  if (/\.(md|mdx|txt)$/i.test(f)) return "docs";
  if (/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\./.test(f)) return "verify";
  return "build";
}

/** Step chips derived from activity: consecutive duplicates collapsed, at most 5. */
export function heuristicSteps(acts: Act[]): TurnStep[] {
  const steps: TurnStep[] = [];
  for (const a of acts) {
    const t = classify(a);
    if (t && steps[steps.length - 1]?.type !== t) steps.push({ type: t, text: "" });
  }
  return steps.slice(0, 5);
}

export interface TurnGroup {
  prompts: number[];
  title?: string;
  steps?: { type?: string; text?: string }[];
  outcome?: string;
  decisions?: { text?: string; why?: string }[];
  tips?: { keep?: string[]; improve?: string[] };
}

const cleanStr = (v: unknown, max: number) => truncate(redact(String(v ?? "")).replace(/\s+/g, " "), max);

const SYNONYMS: Record<string, string> = {
  test: "verify",
  testing: "verify",
  validate: "verify",
  check: "verify",
  debug: "fix",
  bugfix: "fix",
  research: "investigate",
  explore: "investigate",
  analyze: "investigate",
  implement: "build",
  code: "build",
  document: "docs",
  doc: "docs",
  design: "plan",
  clarify: "plan",
  deploy: "ship",
  release: "ship",
  push: "ship",
  cleanup: "refactor",
};

/** Map free-form step types onto the fixed set when they mean the same thing. */
export function normalizeType(t: string): string {
  const k = t.toLowerCase().trim();
  return SYNONYMS[k] ?? k;
}

/** Group prompts into turns without an LLM: every prompt starts a turn unless it is a short follow-up. */
export function heuristicGroups(raw: RawCapture): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const lastBySession = new Map<string, TurnGroup>();
  for (const p of [...promptList(raw)].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const prev = lastBySession.get(p.sessionId);
    if (prev && !p.carried && p.text.trim().length <= 40 && FOLLOW_UP_RE.test(p.text.trim())) prev.prompts.push(p.index);
    else {
      const g = { prompts: [p.index] };
      groups.push(g);
      lastBySession.set(p.sessionId, g);
    }
  }
  return groups;
}

/**
 * Turn prompt groups (from the model or the heuristic) into Turns.
 * Activity is attributed deterministically: everything a session did from the turn's first prompt
 * until that session's next turn.
 */
export function buildTurns(raw: RawCapture, groups: TurnGroup[]): Turn[] {
  const prompts = promptList(raw);
  // Sanitize: valid indexes, each prompt used once, every prompt covered, ordered by time.
  const used = new Set<number>();
  const clean: TurnGroup[] = [];
  for (const g of groups) {
    const idx = (Array.isArray(g?.prompts) ? g.prompts : []).map(Number).filter((i) => Number.isInteger(i) && prompts[i] && !used.has(i));
    if (!idx.length) continue;
    for (const i of idx) used.add(i);
    clean.push({ ...g, prompts: idx });
  }
  for (const p of prompts) if (!used.has(p.index)) clean.push({ prompts: [p.index] });
  clean.sort((a, b) => prompts[a.prompts[0]].ts.localeCompare(prompts[b.prompts[0]].ts));

  return clean.map((g) => {
    const anchor = prompts[g.prompts[0]];
    const session = sessionOf(raw, anchor.sessionId);
    const next =
      clean
        .map((o) => prompts[o.prompts[0]])
        .filter((o) => o.sessionId === anchor.sessionId && o.ts > anchor.ts)
        .map((o) => o.ts)
        .sort()[0] ?? null;
    const acts = actsIn(session, anchor.ts, next);
    const own = g.prompts.map((i) => prompts[i]).filter((p) => !p.carried);
    const files = new Set(acts.filter((a) => a.file).map((a) => a.file));
    const cmds = acts.filter((a) => a.kind === "command").map((a) => a.text.trim());
    const ends = [anchor.ts, ...acts.map((a) => a.ts), ...g.prompts.map((i) => prompts[i].ts)].sort();
    const modelSteps = (g.steps ?? [])
      .filter((s) => s?.type)
      .slice(0, 5)
      .map((s) => ({ type: normalizeType(cleanStr(s.type, 20)), text: cleanStr(s.text, 140) }));
    const decisions = (g.decisions ?? []).filter((d) => d?.text).map((d) => ({ text: cleanStr(d.text, 200), why: cleanStr(d.why, 200) }));
    const firstText = (own[0] ?? anchor).text;
    return {
      key: `${anchor.sessionId}@${anchor.ts}`,
      title: g.title ? cleanStr(g.title, 90) : cleanStr(firstText, 70),
      prompts: own.map((p) => truncate(redact(p.text), 500)),
      carried: anchor.carried,
      steps: modelSteps.length ? modelSteps : heuristicSteps(acts),
      outcome: cleanStr(g.outcome, 160),
      decisions: decisions.length
        ? decisions
        : acts.filter((a) => a.kind === "decision").map((a) => ({ text: cleanStr(a.text, 200), why: "" })),
      tips: {
        keep: (g.tips?.keep ?? [])
          .slice(0, 2)
          .map((t) => cleanStr(t, 180))
          .filter(Boolean),
        improve: (g.tips?.improve ?? [])
          .slice(0, 2)
          .map((t) => cleanStr(t, 180))
          .filter(Boolean),
      },
      metrics: {
        start: ends[0],
        end: ends[ends.length - 1],
        aiSteps: acts.filter((a) => a.kind !== "decision").length,
        files: files.size,
        reruns: cmds.length - new Set(cmds).size,
      },
      sessionId: anchor.sessionId,
    };
  });
}

export const heuristicTurns = (raw: RawCapture) => buildTurns(raw, heuristicGroups(raw));

export function turnsFromModel(raw: RawCapture, model: unknown): Turn[] {
  if (!Array.isArray(model) || !model.length) return heuristicTurns(raw);
  return buildTurns(raw, model as TurnGroup[]);
}
