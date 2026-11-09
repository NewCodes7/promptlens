import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { commitPatch } from "./git.js";
import { redact, truncate } from "./redact.js";
import { openaiJson } from "./openai.js";
import { heuristicTurns, turnsForPrompt, turnsFromModel } from "./turns.js";
import { SELF_MARKER } from "./sessions.js";
import type { Claim, CommitContext, RawCapture } from "./types.js";

const VERIFY_RE = /\b(test|tests|vitest|jest|pytest|mocha|tsc|typecheck|lint|eslint|build|go test|cargo (?:test|check)|coverage)\b/i;
const PROMPT_MAX = 400;

function allPrompts(raw: RawCapture) {
  return raw.sessions.flatMap((s) => s.prompts);
}

function filesWithAiFlag(raw: RawCapture) {
  const aiEdited = new Set(raw.sessions.flatMap((s) => s.edits.map((e) => e.file)));
  return raw.filesChanged.map((p) => ({ path: p, aiEdited: aiEdited.has(p) }));
}

function baseContext(raw: RawCapture): Omit<CommitContext, "generatedBy" | "intent" | "keyPrompts" | "decisions" | "aiWork" | "verification"> {
  const files = filesWithAiFlag(raw);
  return {
    version: 1,
    sha: raw.sha,
    subject: raw.subject,
    files,
    stats: {
      sessions: raw.sessions.length,
      prompts: allPrompts(raw).filter((p) => !p.carried).length,
      aiEdits: raw.sessions.reduce((n, s) => n + s.edits.length, 0),
    },
    sessionIds: raw.sessions.map((s) => s.sessionId),
  };
}

const clean = (s: string, max = 300) => truncate(redact(s), max);

/** Deterministic Commit Context used when no LLM is available. */
export function heuristicContext(raw: RawCapture): CommitContext {
  const prompts = allPrompts(raw);
  const base = baseContext(raw);
  const aiFiles = base.files.filter((f) => f.aiEdited).map((f) => f.path);
  const commands = raw.sessions.flatMap((s) => s.commands);
  const verification: Claim[] = commands
    .filter((c) => VERIFY_RE.test(c.command))
    .slice(-5)
    .map((c) => ({ text: clean(c.description ? `${c.description} (\`${truncate(c.command, 80)}\`)` : `\`${c.command}\``, 160), inferred: false }));
  return {
    ...base,
    generatedBy: "heuristic",
    turns: heuristicTurns(raw),
    intent: { text: clean(prompts[0]?.text ?? raw.subject, 240), inferred: prompts.length === 0 },
    keyPrompts: prompts.slice(0, 4).map((p, i) => ({
      text: clean(p.text, PROMPT_MAX),
      why: p.carried
        ? "Earlier instruction the agent was still carrying out in this commit."
        : i === 0
          ? "Initial request that started this change."
          : "Follow-up instruction during the session.",
    })),
    decisions: raw.sessions
      .flatMap((s) => s.decisions)
      .map((d) => ({ text: clean(`${d.question} → ${d.answer}`, 240), inferred: false })),
    aiWork: aiFiles.length
      ? [`AI edited ${aiFiles.length} of ${base.files.length} changed file(s): ${aiFiles.slice(0, 6).join(", ")}${aiFiles.length > 6 ? ", …" : ""}`]
      : [],
    verification,
  };
}

export function buildSummaryPrompt(raw: RawCapture, patch: string): string {
  const prompts = allPrompts(raw);
  const lines: string[] = [
    `${SELF_MARKER}`,
    "You are PromptLens. You turn an AI coding session into context that helps a human code reviewer.",
    "Below is (1) what the developer asked an AI agent while producing ONE git commit, (2) what the agent did, and (3) the commit diff.",
    "Write for a reviewer who only sees the diff: why was it changed, which instructions shaped it, what was decided, how it was verified.",
    "Rules:",
    "- Respond in English, even if the prompts are in another language.",
    "- Only state what the session or diff supports. If you are guessing, set inferred=true.",
    "- Never include secrets, tokens, emails or personal data.",
    "- Be terse. Each string <= 200 characters.",
    "",
    `Commit subject: ${raw.subject}`,
    "",
    "## Developer prompts (indexed)",
    ...prompts.map((p, i) => `[${i}]${p.carried ? " (given before this commit, still in effect)" : ""} ${truncate(p.text, 1500)}`),
    "",
    "## Decisions the developer made when the agent asked",
    ...raw.sessions.flatMap((s) => s.decisions.map((d) => `- Q: ${truncate(d.question, 300)} A: ${truncate(d.answer, 300)}`)),
    "",
    "## Developer prompts with what the agent did after each",
    turnsForPrompt(raw),
    "",
    "## Agent explanations (excerpts)",
    ...raw.sessions.flatMap((s) => s.assistantNotes.map((n) => `- ${truncate(n, 300)}`)).slice(-30),
    "",
    "## Diff",
    patch,
    "",
    "Return ONLY a JSON object, no prose, with this exact shape:",
    `{"intent":{"text":string,"inferred":boolean},"keyPrompts":[{"index":number,"why":string}],"decisions":[{"text":string,"inferred":boolean}],"aiWork":[string],"verification":[{"text":string,"inferred":boolean}],"turns":[{"prompts":[number],"title":string,"steps":[{"type":string,"text":string}],"outcome":string,"decisions":[{"text":string,"why":string}],"tips":{"keep":[string],"improve":[string]}}]}`,
    "turns: group the developer PROMPTs into requests, in order. A new turn starts when the developer asks for something new;",
    "  short confirmations, answers, status checks or nudges that continue the same request join the previous turn. Every prompt index belongs to exactly one turn.",
    "  title: <= 10 words, English, the developer's intent (e.g. 'Make the PR report show the prompt flow').",
    "  steps: 1-5 steps the agent took for this request, in order. type: investigate | plan | build | fix | verify | refactor | docs | ship (or one short word if none fits). text: <= 15 words, concrete.",
    "  outcome: <= 15 words, what this request ended with (e.g. 'Regex narrowed; 33 tests pass; PR comment updated').",
    "  decisions: choices made for this request with a short why (include the developer's answers to agent questions). [] if none.",
    "  tips: prompt review of the developer's prompt(s) in this turn, specific to what happened (not generic advice).",
    "    keep: 1-2 things the prompt did well that led to a good result and are worth repeating (e.g. 'Asked to resolve ambiguity via a survey before coding').",
    "    improve: 0-2 concrete additions that would have saved iterations (e.g. 'State the target layout up front; two rounds went to node width').",
    "    For a turn that only continues a carried prompt, tips may be empty.",
    "keyPrompts: pick at most 3 prompt indexes that a reviewer most needs to see verbatim. verification: [] if nothing was verified.",
  ];
  return lines.join("\n");
}

export function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

const asClaims = (v: unknown): Claim[] =>
  Array.isArray(v)
    ? v.filter((c) => c && typeof c.text === "string").map((c) => ({ text: clean(c.text, 240), inferred: Boolean(c.inferred) }))
    : [];

/** Merge a model response into a Commit Context. Prompts are always quoted from the capture, never from the model. */
export function contextFromModel(raw: RawCapture, model: any, generatedBy: CommitContext["generatedBy"] = "claude-cli"): CommitContext {
  const prompts = allPrompts(raw);
  const fallback = heuristicContext(raw);
  const picked: number[] = Array.isArray(model?.keyPrompts) ? model.keyPrompts.map((k: any) => Number(k.index)) : [];
  const keyPrompts = (model?.keyPrompts ?? [])
    .filter((k: any, i: number) => Number.isInteger(picked[i]) && prompts[picked[i]])
    .slice(0, 3)
    .map((k: any) => ({ text: clean(prompts[Number(k.index)].text, PROMPT_MAX), why: clean(String(k.why ?? ""), 200) }));
  return {
    ...baseContext(raw),
    generatedBy,
    turns: turnsFromModel(raw, model?.turns),
    intent:
      model?.intent && typeof model.intent.text === "string"
        ? { text: clean(model.intent.text, 240), inferred: Boolean(model.intent.inferred) }
        : fallback.intent,
    keyPrompts: keyPrompts.length ? keyPrompts : fallback.keyPrompts,
    decisions: asClaims(model?.decisions).length ? asClaims(model?.decisions) : fallback.decisions,
    aiWork: Array.isArray(model?.aiWork) ? model.aiWork.filter((s: unknown) => typeof s === "string").map((s: string) => clean(s, 200)) : fallback.aiWork,
    verification: asClaims(model?.verification),
  };
}

function runClaude(prompt: string): string {
  const model = process.env.PROMPTLENS_CLAUDE_MODEL ?? "sonnet";
  // Run outside the repo so this helper session is never captured as part of the developer's work.
  const res = spawnSync("claude", ["-p", "--output-format", "json", "--model", model], {
    input: prompt,
    cwd: tmpdir(),
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  let outer: any = null;
  try {
    outer = JSON.parse(res.stdout);
  } catch {
    /* non-JSON output */
  }
  if (res.status !== 0 && !outer) throw new Error(`claude -p exited ${res.status}: ${res.stderr || res.error?.message || res.stdout}`);
  if (outer.is_error) throw new Error(`claude -p error: ${outer.result}`);
  return String(outer.result ?? "");
}

/**
 * Build the shareable Commit Context.
 * Provider chain: local Claude Code CLI → OpenAI (if OPENAI_API_KEY is set) → deterministic heuristic.
 */
export async function summarize(raw: RawCapture, cwd?: string): Promise<CommitContext> {
  if (raw.sessions.length === 0 || process.env.PROMPTLENS_NO_LLM === "1") return heuristicContext(raw);
  const prompt = buildSummaryPrompt(raw, commitPatch(raw.sha, 12_000, cwd));
  if (process.env.PROMPTLENS_PROVIDER !== "openai") {
    try {
      return contextFromModel(raw, extractJson(runClaude(prompt)), "claude-cli");
    } catch (err) {
      process.stderr.write(`[promptlens] claude -p summary failed: ${(err as Error).message}\n`);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return contextFromModel(raw, await openaiJson(prompt), "openai");
    } catch (err) {
      process.stderr.write(`[promptlens] OpenAI summary failed: ${(err as Error).message}\n`);
    }
  }
  return heuristicContext(raw);
}
