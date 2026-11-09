import type { CommitEntry } from "./report.js";
import type { Phase } from "./types.js";

export const MAX_FLOW_PHASES = 10;

const ICON: Record<string, string> = {
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

export interface FlowPhase extends Omit<Phase, "sessionId"> {
  sessions: string[];
  /** Commits that were created at the end of this chunk. */
  commits: string[];
}

const weight = (p: FlowPhase) => p.prompts * 2 + p.files + p.commands + p.decisions.length + 1;
const title = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const cls = (t: string) => (STYLE[t] && t !== "commit" ? t : "custom");
export const icon = (t: string) => ICON[t] ?? "🔸";

/** Lay every commit's phases end to end; each commit is attached to the last phase that produced it. */
export function collectPhases(entries: CommitEntry[]): FlowPhase[] {
  const out: FlowPhase[] = [];
  for (const e of entries) {
    const c = e.context;
    let phases: Phase[];
    if (!c) phases = [{ type: "manual", label: e.subject, prompt: null, decisions: [], prompts: 0, files: 0, commands: 0, sessionId: "" }];
    else if (c.phases?.length) phases = c.phases;
    else
      phases = [
        {
          type: "build",
          label: e.subject,
          prompt: c.keyPrompts[0]?.text ?? null,
          decisions: c.decisions.map((d) => ({ text: d.text, why: "" })),
          prompts: c.stats.prompts,
          files: c.files.filter((f) => f.aiEdited).length,
          commands: 0,
          sessionId: c.sessionIds[0] ?? "",
        },
      ];
    phases.forEach((p, i) =>
      out.push({
        ...p,
        sessions: p.sessionId ? [p.sessionId] : [],
        commits: i === phases.length - 1 ? [e.sha] : [],
      }),
    );
  }
  return out;
}

function mergePair(a: FlowPhase, b: FlowPhase): FlowPhase {
  const [big, small] = weight(a) >= weight(b) ? [a, b] : [b, a];
  const label = a.label === b.label ? a.label : `${big.label} + ${small.label}`;
  return {
    type: big.type,
    label: label.length > 70 ? label.slice(0, 69) + "…" : label,
    prompt: a.prompt ?? b.prompt,
    decisions: [...a.decisions, ...b.decisions],
    prompts: a.prompts + b.prompts,
    files: a.files + b.files,
    commands: a.commands + b.commands,
    sessions: [...new Set([...a.sessions, ...b.sessions])],
    commits: [...a.commits, ...b.commits],
  };
}

/**
 * Keep the flow readable whatever the session count or length:
 * first merge neighbouring chunks of the same type, then the lightest neighbours, until at most `max` remain.
 */
export function mergeToMax(phases: FlowPhase[], max = MAX_FLOW_PHASES): FlowPhase[] {
  const list = [...phases];
  while (list.length > max) {
    let best = -1;
    let bestSame = false;
    for (let k = 0; k < list.length - 1; k++) {
      const same = list[k].type === list[k + 1].type;
      const w = weight(list[k]) + weight(list[k + 1]);
      if (best < 0 || (same && !bestSame) || (same === bestSame && w < weight(list[best]) + weight(list[best + 1]))) {
        best = k;
        bestSame = same;
      }
    }
    list.splice(best, 2, mergePair(list[best], list[best + 1]));
  }
  return list;
}

function mm(text: string, max = 46): string {
  const t = text.replace(/\s+/g, " ").replace(/["`#<>{}|]/g, "'").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function esc(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stats(p: FlowPhase): string[] {
  const s: string[] = [p.prompts ? `${p.prompts} prompt${p.prompts > 1 ? "s" : ""}` : "AI-driven"];
  if (p.files) s.push(`${p.files} file${p.files > 1 ? "s" : ""}`);
  if (p.decisions.length) s.push(`${p.decisions.length} decision${p.decisions.length > 1 ? "s" : ""}`);
  return s;
}

/** Mermaid flowchart + per-chunk details (representative prompt, decisions and why). */
export function renderFlow(entries: CommitEntry[], max = MAX_FLOW_PHASES): string {
  const phases = mergeToMax(collectPhases(entries), max);
  if (!phases.length) return "";
  const sessionIds = [...new Set(phases.flatMap((p) => p.sessions))];
  const badge = (p: FlowPhase) => (sessionIds.length > 1 ? ` · ${p.sessions.map((s) => `S${sessionIds.indexOf(s) + 1}`).join("+")}` : "");

  // Wide labels so chunks read in one or two lines; commits ride on the arrows so the spine stays straight.
  const lines = [
    "```mermaid",
    `%%{init: {"flowchart": {"wrappingWidth": 460, "nodeSpacing": 24, "rankSpacing": 34}, "themeVariables": {"fontSize": "15px"}}}%%`,
    "flowchart TD",
  ];
  const commitLabel = (p: FlowPhase) => `⎇ ${mm(p.commits.map((s) => s.slice(0, 7)).join(" · "), 60)}`;
  phases.forEach((p, i) => {
    const head = `${CIRCLED[i] ?? i + 1} ${icon(p.type)} ${title(p.type)} — ${mm(p.label, 60)}`;
    lines.push(`  P${i}["<b>${head}</b><br/>${mm(stats(p).join(" · ") + badge(p), 60)}"]:::${cls(p.type)}`);
    if (i > 0) {
      const prev = phases[i - 1];
      lines.push(prev.commits.length ? `  P${i - 1} -->|"${commitLabel(prev)}"| P${i}` : `  P${i - 1} --> P${i}`);
    }
  });
  const last = phases[phases.length - 1];
  if (last.commits.length) lines.push(`  P${phases.length - 1} --- END(["${commitLabel(last)}"]):::commit`);
  const used = new Set(phases.map((p) => cls(p.type)));
  for (const [k, v] of Object.entries(STYLE)) if (used.has(k) || k === "commit") lines.push(`  classDef ${k} ${v}`);
  lines.push("```");

  const details = phases.map((p, i) => {
    const commits = p.commits.length ? ` · → ${p.commits.map((s) => `<code>${s.slice(0, 7)}</code>`).join(" ")}` : "";
    const out = [
      `<details><summary><b>${CIRCLED[i] ?? i + 1} ${icon(p.type)} ${esc(title(p.type))} — ${esc(p.label)}</b> · ${stats(p).join(" · ")}${badge(p)}${commits}</summary>`,
      "",
      p.prompt
        ? esc(p.prompt)
            .split("\n")
            .map((l, j) => (j === 0 ? `> 🧑‍💻 ${l}` : `> ${l}`))
            .join("\n")
        : "> 🤖 _The agent continued on its own (no new prompt in this chunk)._",
      "",
    ];
    if (p.decisions.length) {
      out.push(...p.decisions.slice(0, 8).map((d) => `- **${esc(d.text.replace(/\s+/g, " "))}**${d.why ? ` — ${esc(d.why.replace(/\s+/g, " "))}` : ""}`), "");
    }
    out.push("</details>");
    return out.join("\n");
  });

  return [...lines, "", ...details].join("\n");
}
