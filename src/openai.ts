import type { CommitEntry, Synthesis } from "./report.js";
import { templateSynthesis } from "./report.js";
import { redact, truncate } from "./redact.js";

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
  return [
    "You write the PR-level summary of PromptLens, a tool that adds AI coding context to code review.",
    "Input: per-commit Commit Context (already summarized from the developer's AI sessions) and the final diff stat.",
    "Synthesize for a reviewer who is about to read the diff. Focus on the final state of the PR, not the history.",
    "Rules: English only. Terse (each string <= 220 chars). Do not invent facts; mark guesses with inferred=true.",
    "reviewFocus: up to 5 concrete places (file + reason) where human judgment matters most (unverified, risky, or non-obvious choices).",
    "openQuestions: things the reviewer should ask the author (e.g. commits with no context, unverified claims). [] if none.",
    "",
    "Return ONLY JSON:",
    `{"overview":string,"why":[string],"keyDecisions":[{"text":string,"inferred":boolean}],"reviewFocus":[{"file":string,"text":string}],"openQuestions":[string]}`,
    "",
    "## Diff stat",
    truncate(diffStat, 4000),
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
    why: arr(json?.why).map((s) => str(s)).filter(Boolean),
    keyDecisions: arr(json?.keyDecisions)
      .filter((d: any) => d?.text)
      .map((d: any) => ({ text: str(d.text), inferred: Boolean(d.inferred) })),
    reviewFocus: arr(json?.reviewFocus)
      .filter((f: any) => f?.text)
      .map((f: any) => ({ file: f.file ? str(f.file, 200) : undefined, text: str(f.text) })),
    openQuestions: [...new Set([...arr(json?.openQuestions).map((q) => str(q)), ...fallback.openQuestions])],
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
