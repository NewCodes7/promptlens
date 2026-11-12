import { dedupe, textKey } from "./dedupe.js";
import type { CommitEntry } from "./report.js";
import type { CommitContext, Turn, TurnStep } from "./types.js";

export const MAX_FLOW_TURNS = 10;

const ICON: Record<string, string> = {
  investigate: "🔍",
  plan: "🧭",
  build: "🛠️",
  fix: "🐛",
  verify: "🧪",
  refactor: "♻️",
  docs: "📝",
  ship: "🚀",
  manual: "✋",
};
const STYLE: Record<string, string> = {
  investigate: "fill:#f1f5f9,stroke:#475569,color:#0f172a",
  plan: "fill:#dbeafe,stroke:#2563eb,color:#0f172a",
  build: "fill:#dcfce7,stroke:#16a34a,color:#0f172a",
  fix: "fill:#fee2e2,stroke:#dc2626,color:#0f172a",
  verify: "fill:#fef9c3,stroke:#ca8a04,color:#0f172a",
  refactor: "fill:#ede9fe,stroke:#7c3aed,color:#0f172a",
  docs: "fill:#e0f2fe,stroke:#0284c7,color:#0f172a",
  ship: "fill:#ffedd5,stroke:#ea580c,color:#0f172a",
  custom: "fill:#f3f4f6,stroke:#6b7280,color:#0f172a",
  commit: "fill:#24292f,stroke:#24292f,color:#ffffff",
};
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

/** A developer request as shown on the PR: pieces of the same request across commits merged into one. */
export interface FlowTurn extends Omit<Turn, "sessionId" | "carried"> {
  sessions: string[];
  /** Commits finished while working on this request. */
  commits: string[];
  /** Outcome of every piece, oldest first — input for a whole-request outcome rewrite. */
  outcomes: string[];
  manual?: boolean;
}

export const icon = (t: string) => ICON[t] ?? "🔸";
const title = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const cls = (t: string) => (STYLE[t] && t !== "commit" ? t : "custom");
const weight = (t: FlowTurn) => t.prompts.length * 3 + t.metrics.aiSteps + t.decisions.length + 1;

function mergeSteps(a: TurnStep[], b: TurnStep[]): TurnStep[] {
  const out = [...a];
  for (const s of b) if (!out.some((o) => o.type === s.type && o.text === s.text)) out.push(s);
  return out;
}

type Decision = Turn["decisions"][number];

/** Each decision once (same text up to case and whitespace): the first copy stays, a later copy fills its empty why. */
function mergeDecisions(a: Decision[], b: Decision[]): Decision[] {
  const all = [...a, ...b];
  const whyOf = (d: Decision) => all.find((o) => o.why.trim() && textKey(o.text) === textKey(d.text))?.why ?? d.why;
  return dedupe(all, (d) => d.text).map((d) => (d.why.trim() ? d : { ...d, why: whyOf(d) }));
}

function mergeMetrics(a: Turn["metrics"], b: Turn["metrics"]): Turn["metrics"] {
  // ISO-8601 timestamps sort as strings; Math.min/max would coerce them to NaN.
  return {
    // biome-ignore lint/complexity/useMathMinMax: string comparison, see above
    start: a.start < b.start ? a.start : b.start,
    // biome-ignore lint/complexity/useMathMinMax: string comparison, see above
    end: a.end > b.end ? a.end : b.end,
    aiSteps: a.aiSteps + b.aiSteps,
    files: a.files + b.files,
    reruns: a.reruns + b.reruns,
  };
}

function fromTurn(t: Turn): FlowTurn {
  const { sessionId, carried: _c, ...rest } = t;
  return { ...rest, sessions: [sessionId], commits: [], outcomes: t.outcome ? [t.outcome] : [] };
}

/**
 * Pieces of one request (same key) that continue across commits become one FlowTurn.
 * `into` shares its arrays with the first piece's note, so they are replaced, never pushed to: the same entries are
 * collected more than once per run (synthesis prompt, review file, PR comment).
 */
function absorb(into: FlowTurn, piece: Turn): void {
  const real = !piece.carried && piece.prompts.length > 0;
  if (real || !into.title) into.title = piece.title;
  into.prompts = [...into.prompts, ...piece.prompts];
  into.steps = mergeSteps(into.steps, piece.steps);
  if (piece.outcome) {
    into.outcome = piece.outcome;
    into.outcomes.push(piece.outcome);
  }
  into.decisions = mergeDecisions(into.decisions, piece.decisions);
  if (piece.tips.keep.length || piece.tips.improve.length) {
    if (real || (!into.tips.keep.length && !into.tips.improve.length)) into.tips = piece.tips;
  }
  into.metrics = mergeMetrics(into.metrics, piece.metrics);
}

function legacyTurn(e: CommitEntry, c: CommitContext): Turn {
  return {
    key: `legacy@${e.sha}`,
    title: e.subject,
    prompts: c.keyPrompts.map((k) => k.text),
    carried: false,
    steps: [],
    outcome: c.intent.text,
    decisions: c.decisions.map((d) => ({ text: d.text, why: "" })),
    tips: { keep: [], improve: [] },
    metrics: { start: "", end: "", aiSteps: c.stats.aiEdits, files: c.files.filter((f) => f.aiEdited).length, reruns: 0 },
    sessionId: c.sessionIds[0] ?? "",
  };
}

/** Lay out the PR's requests in order; each commit hangs off the request that was active when it was made. */
export function collectTurns(entries: CommitEntry[]): FlowTurn[] {
  const out: FlowTurn[] = [];
  const byKey = new Map<string, FlowTurn>();
  for (const e of entries) {
    const c = e.context;
    if (!c) {
      const manual: FlowTurn = {
        key: `manual@${e.sha}`,
        title: e.subject,
        prompts: [],
        steps: [{ type: "manual", text: "Committed without an AI session" }],
        outcome: "",
        decisions: [],
        tips: { keep: [], improve: [] },
        metrics: { start: "", end: "", aiSteps: 0, files: 0, reruns: 0 },
        sessions: [],
        commits: [e.sha],
        outcomes: [],
        manual: true,
      };
      out.push(manual);
      continue;
    }
    const turns = c.turns?.length ? c.turns : [legacyTurn(e, c)];
    let last: FlowTurn | undefined;
    for (const t of turns) {
      const existing = byKey.get(t.key);
      if (existing && out[out.length - 1] === existing) absorb(existing, t);
      else {
        const ft = fromTurn(t);
        out.push(ft);
        byKey.set(t.key, ft);
      }
      last = byKey.get(t.key);
    }
    last?.commits.push(e.sha);
  }
  return out;
}

/** Keep the flow readable: merge the lightest neighbouring requests until at most `max` remain. */
export function mergeToMax(turns: FlowTurn[], max = MAX_FLOW_TURNS): FlowTurn[] {
  const list = [...turns];
  while (list.length > max) {
    let best = 0;
    for (let k = 1; k < list.length - 1; k++) {
      if (weight(list[k]) + weight(list[k + 1]) < weight(list[best]) + weight(list[best + 1])) best = k;
    }
    const [a, b] = [list[best], list[best + 1]];
    const big = weight(a) >= weight(b) ? a : b;
    const small = big === a ? b : a;
    list.splice(best, 2, {
      ...big,
      key: a.key,
      title: `${big.title} (+ ${small.title})`.slice(0, 110),
      prompts: [...a.prompts, ...b.prompts],
      steps: mergeSteps(a.steps, b.steps),
      outcome: b.outcome || a.outcome,
      decisions: mergeDecisions(a.decisions, b.decisions),
      tips: big.tips,
      metrics: a.metrics.start && b.metrics.start ? mergeMetrics(a.metrics, b.metrics) : big.metrics,
      sessions: [...new Set([...a.sessions, ...b.sessions])],
      commits: [...a.commits, ...b.commits],
      outcomes: [...a.outcomes, ...b.outcomes],
      manual: a.manual && b.manual,
    });
  }
  return list;
}

export function duration(start: string, end: string): string {
  const ms = Date.parse(end) - Date.parse(start);
  if (!start || !end || !Number.isFinite(ms) || ms <= 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

export function metricsLine(t: FlowTurn): string {
  const parts: string[] = [];
  const d = duration(t.metrics.start, t.metrics.end);
  if (d) parts.push(`⏱ ${d}`);
  parts.push(`💬 ${t.prompts.length} prompt${t.prompts.length === 1 ? "" : "s"}`);
  if (t.metrics.aiSteps) parts.push(`🤖 ${t.metrics.aiSteps} AI steps`);
  if (t.metrics.files) parts.push(`📄 ${t.metrics.files} files`);
  if (t.metrics.reruns) parts.push(`🔁 ${t.metrics.reruns} re-runs`);
  return parts.join(" · ");
}

function chipTypes(t: FlowTurn): string[] {
  const types: string[] = [];
  for (const s of t.steps) if (types[types.length - 1] !== s.type) types.push(s.type);
  return types.slice(0, 6);
}

/** The step type that best represents the request (most frequent; first wins ties). */
function dominant(t: FlowTurn): string {
  if (t.manual) return "custom";
  const count = new Map<string, number>();
  for (const s of t.steps) count.set(s.type, (count.get(s.type) ?? 0) + 1);
  let best = t.steps[0]?.type ?? "build";
  for (const [k, v] of count) if (v > (count.get(best) ?? 0)) best = k;
  return cls(best);
}

function mm(text: string, max = 70): string {
  const t = text
    .replace(/\s+/g, " ")
    .replace(/["`#<>{}|]/g, "'")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function esc(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const one = (s: string) => esc(s.replace(/\s+/g, " ").trim());

/** Mermaid flowchart of developer requests + per-request details (prompts, AI steps, decisions, prompt review). */
export function renderFlow(
  entries: CommitEntry[],
  max = MAX_FLOW_TURNS,
  outcomeOverrides: (string | undefined)[] = [],
  translate: (s: string) => string = (s) => s,
): string {
  const turns = mergeToMax(collectTurns(entries), max).map((t, i) => {
    const outcome = outcomeOverrides[i];
    return outcome ? { ...t, outcome } : t;
  });
  if (!turns.length) return "";
  const sessionIds = [...new Set(turns.flatMap((t) => t.sessions))];
  const badge = (t: FlowTurn) =>
    sessionIds.length > 1 && t.sessions.length ? ` · ${t.sessions.map((s) => `S${sessionIds.indexOf(s) + 1}`).join("+")}` : "";
  const commitLabel = (t: FlowTurn) => `⎇ ${mm(t.commits.map((s) => s.slice(0, 7)).join(" · "), 60)}`;

  const lines = [
    "```mermaid",
    `%%{init: {"flowchart": {"wrappingWidth": 460, "nodeSpacing": 24, "rankSpacing": 34}, "themeVariables": {"fontSize": "15px"}}}%%`,
    "flowchart TD",
  ];
  turns.forEach((t, i) => {
    const who = t.manual ? "✋" : t.prompts.length ? "🧑‍💻" : "🤖";
    const rows = [`<b>${CIRCLED[i] ?? i + 1} ${who} ${mm(t.title, 80)}</b>`];
    const chips = chipTypes(t);
    if (chips.length && !t.manual) rows.push(mm(chips.map((c) => `${icon(c)} ${title(c)}`).join(" → "), 90));
    if (t.outcome) rows.push(`✅ ${mm(t.outcome, 110)}`);
    rows.push(mm(metricsLine(t) + badge(t), 90));
    lines.push(`  T${i}["${rows.join("<br/>")}"]:::${dominant(t)}`);
    if (i > 0) {
      const prev = turns[i - 1];
      lines.push(prev.commits.length ? `  T${i - 1} -->|"${commitLabel(prev)}"| T${i}` : `  T${i - 1} --> T${i}`);
    }
  });
  const last = turns[turns.length - 1];
  if (last.commits.length) lines.push(`  T${turns.length - 1} --- END(["${commitLabel(last)}"]):::commit`);
  const used = new Set(turns.map(dominant));
  for (const [k, v] of Object.entries(STYLE)) if (used.has(k) || k === "commit") lines.push(`  classDef ${k} ${v}`);
  lines.push("```");

  const details = turns.map((t, i) => {
    const commits = t.commits.length ? ` · ⎇ ${t.commits.map((s) => `<code>${s.slice(0, 7)}</code>`).join(" ")}` : "";
    const out = [
      `<details><summary><b>${CIRCLED[i] ?? i + 1} ${one(t.title)}</b> · ${one(metricsLine(t))}${badge(t)}${commits}</summary>`,
      "",
    ];
    if (t.prompts.length) {
      out.push("**🧑‍💻 Prompt**", "");
      let translated = false;
      for (const p of t.prompts) {
        const shown = translate(p);
        translated ||= shown !== p;
        out.push(
          esc(shown)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
          "",
        );
      }
      if (translated) out.push("<sub>🌐 Translated to English from the original prompt.</sub>", "");
    } else if (!t.manual) out.push("> 🤖 _Continued an earlier request without a new prompt._", "");
    if (t.steps.length) {
      const step = (s: TurnStep) => `${icon(s.type)} **${one(title(s.type))}**${s.text ? ` — ${one(s.text)}` : ""}`;
      // Long requests (spanning many commits) keep the beginning and the end; the middle collapses.
      const shown =
        t.steps.length > 8
          ? [...t.steps.slice(0, 3).map(step), `… ${t.steps.length - 8} more steps`, ...t.steps.slice(-5).map(step)]
          : t.steps.map(step);
      out.push("**🤖 What the AI did**", ...shown.map((s) => `- ${s}`), "");
    }
    if (t.outcome) out.push(`✅ **Outcome:** ${one(t.outcome)}`, "");
    if (t.decisions.length) {
      out.push("**Decisions**", ...t.decisions.slice(0, 8).map((d) => `- **${one(d.text)}**${d.why ? ` — ${one(d.why)}` : ""}`), "");
    }
    if (t.tips.keep.length || t.tips.improve.length) {
      out.push(
        "**🎯 Prompt review**",
        ...t.tips.keep.map((k) => `- 👍 **Keep:** ${one(k)}`),
        ...t.tips.improve.map((k) => `- 💡 **Try:** ${one(k)}`),
        "",
      );
    }
    out.push("</details>");
    return out.join("\n");
  });

  return [...lines, "", ...details].join("\n");
}
