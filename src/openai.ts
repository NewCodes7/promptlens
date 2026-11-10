import { collectTurns, mergeToMax } from "./flow.js";
import { redact, truncate } from "./redact.js";
import type { CommitEntry, Synthesis } from "./report.js";
import { templateSynthesis } from "./report.js";

export function buildSynthesisPrompt(entries: CommitEntry[], diffStat: string): string {
  const commits = entries.map((e) => ({
    sha: e.sha.slice(0, 7),
    subject: e.subject,
    context: e.context
      ? {
          intent: e.context.intent,
          keyPrompts: e.context.keyPrompts,
          decisions: e.context.decisions,
          aiWork: e.context.aiWork,
          verification: e.context.verification,
          files: e.context.files,
        }
      : null,
  }));
  const requests = mergeToMax(collectTurns(entries)).map((t, index) => ({
    index,
    title: t.title,
    steps: t.steps.map((st) => `${st.type}: ${st.text}`).slice(0, 12),
    pieceOutcomes: t.outcomes,
    commits: t.commits.map((c) => c.slice(0, 7)),
  }));
  return [
    "You write the PR-level summary of PromptLens, a tool that adds AI coding context to code review.",
    "Input: per-commit Commit Context (already summarized from the developer's AI sessions) and the final diff stat.",
    "Synthesize for a reviewer who is about to read the diff. Focus on the final state of the PR, not the history.",
    "Rules: English only. Terse (each string <= 220 chars). Do not invent facts; mark guesses with inferred=true.",
    "reviewFocus: up to 5 concrete places (file + reason) where human judgment matters most (unverified, risky, or non-obvious choices).",
    "openQuestions: things the reviewer should ask the author (e.g. commits with no context, unverified claims). [] if none.",
    "requests: for EVERY developer request listed under Requests, one outcome (<= 15 words) describing what the whole request ended with, across all its commits (pieceOutcomes are per-commit, oldest first).",
    "",
    "Return ONLY JSON:",
    `{"overview":string,"why":[string],"keyDecisions":[{"text":string,"inferred":boolean}],"reviewFocus":[{"file":string,"text":string}],"openQuestions":[string],"requests":[{"index":number,"outcome":string}]}`,
    "",
    "## Diff stat",
    truncate(diffStat, 4000),
    "",
    "## Requests (developer prompts, in order)",
    truncate(JSON.stringify(requests, null, 1), 20_000),
    "",
    "## Commits",
    truncate(JSON.stringify(commits, null, 1), 60_000),
  ].join("\n");
}

const str = (v: unknown, max = 260) => truncate(redact(String(v ?? "")), max);

export function synthesisFromModel(json: any, generatedBy: string, fallback: Synthesis): Synthesis {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    overview: json?.overview ? str(json.overview, 500) : fallback.overview,
    why: arr(json?.why)
      .map((s) => str(s))
      .filter(Boolean),
    keyDecisions: arr(json?.keyDecisions)
      .filter((d: any) => d?.text)
      .map((d: any) => ({ text: str(d.text), inferred: Boolean(d.inferred) })),
    reviewFocus: arr(json?.reviewFocus)
      .filter((f: any) => f?.text)
      .map((f: any) => ({ file: f.file ? str(f.file, 200) : undefined, text: str(f.text) })),
    openQuestions: [...new Set([...arr(json?.openQuestions).map((q) => str(q)), ...fallback.openQuestions])],
    turnOutcomes: arr(json?.requests).reduce((acc: (string | undefined)[], r: any) => {
      const i = Number(r?.index);
      if (Number.isInteger(i) && i >= 0 && i < 50 && r?.outcome) acc[i] = str(r.outcome, 160);
      return acc;
    }, []),
    generatedBy,
  };
}

export const openaiModel = () => process.env.OPENAI_MODEL || "gpt-5-mini";

/** Call OpenAI Chat Completions in JSON mode and return the parsed object. */
export async function openaiJson(prompt: string): Promise<any> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: openaiModel(),
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

/** PR-level synthesis via the OpenAI Chat Completions API. Falls back to the template on any failure. */
export async function synthesize(entries: CommitEntry[], diffStat: string): Promise<Synthesis> {
  const fallback = templateSynthesis(entries);
  if (!process.env.OPENAI_API_KEY || entries.every((e) => !e.context)) return fallback;
  try {
    const json = await openaiJson(buildSynthesisPrompt(entries, diffStat));
    return synthesisFromModel(json, `OpenAI ${openaiModel()}`, fallback);
  } catch (err) {
    process.stderr.write(`[promptlens] OpenAI synthesis failed, using template: ${(err as Error).message}\n`);
    return fallback;
  }
}

/** Text worth translating: contains letters outside the Latin script (e.g. Korean). */
export function needsTranslation(text: string): boolean {
  return /[^\P{L}\p{Script=Latin}]/u.test(text);
}

/**
 * Translate non-English prompts to English for the PR comment (notes keep the original).
 * Returns original → English; texts that fail or need no translation are simply absent.
 */
export async function translatePrompts(texts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo = [...new Set(texts)].filter(needsTranslation);
  if (!todo.length || !process.env.OPENAI_API_KEY) return out;
  const prompt = [
    "Translate each developer prompt below into natural English for a code reviewer.",
    "Rules: translate faithfully and completely (do not summarize); keep the author's tone, line breaks, markdown, code, file paths, URLs and [REDACTED:...] tokens exactly as they are.",
    'Return ONLY JSON: {"items":[{"id":number,"en":string}]}',
    "",
    JSON.stringify({ items: todo.map((text, id) => ({ id, text })) }),
  ].join("\n");
  try {
    const json = await openaiJson(prompt);
    for (const it of Array.isArray(json?.items) ? json.items : []) {
      const src = todo[Number(it?.id)];
      if (src && typeof it?.en === "string" && it.en.trim()) out.set(src, redact(it.en.trim()));
    }
  } catch (err) {
    process.stderr.write(`[promptlens] prompt translation failed, showing originals: ${(err as Error).message}\n`);
  }
  return out;
}
