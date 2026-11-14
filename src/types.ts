/** A single human prompt typed into an AI coding session. */
interface PromptEvent {
  ts: string;
  text: string;
  /** true when the prompt was given before this commit's window but the agent was still acting on it. */
  carried?: boolean;
}

/** A file-modifying tool call made by the AI (Edit, Write, MultiEdit, ...). */
interface EditEvent {
  ts: string;
  tool: string;
  /** Path relative to the repository root. */
  file: string;
}

/** A shell command run by the AI — used to detect verification (tests, builds). */
interface CommandEvent {
  ts: string;
  command: string;
  description?: string;
}

/** A question the AI asked the developer and the answer it got. */
interface DecisionEvent {
  ts: string;
  question: string;
  answer: string;
}

/** Everything one AI session contributed inside a commit window. */
export interface SessionSlice {
  sessionId: string;
  agent: "claude-code";
  prompts: PromptEvent[];
  edits: EditEvent[];
  commands: CommandEvent[];
  decisions: DecisionEvent[];
  /** Short excerpts of the assistant's own explanations (for summarization only, never published raw). */
  assistantNotes: string[];
}

/** Raw, private capture for one commit. Stays in .git/promptlens — never pushed. */
export interface RawCapture {
  version: 1;
  sha: string;
  subject: string;
  window: { from: string | null; to: string };
  filesChanged: string[];
  sessions: SessionSlice[];
}

interface KeyPrompt {
  /** Redacted, possibly truncated prompt text. */
  text: string;
  /** Why this prompt matters for review. */
  why: string;
}

export interface Claim {
  text: string;
  /** true when the claim was inferred by the model rather than stated in the session. */
  inferred: boolean;
}

export interface TurnStep {
  /** investigate · plan · build · fix · verify · refactor · docs · ship, or a free-form type the model chose. */
  type: string;
  text: string;
}

/**
 * A turn: one developer request (plus same-intent follow-ups like "yes, do it") and what the agent did for it.
 * A request whose work spans several commits appears as one piece per commit, sharing the same `key`.
 */
export interface Turn {
  /** `${sessionId}@${ts of the anchoring prompt}` — identical across the commits a request spans. */
  key: string;
  /** English one-line intent of the request. */
  title: string;
  /** Redacted, verbatim prompts that belong to this turn (empty when this piece only continues an earlier request). */
  prompts: string[];
  /** true when this piece continues a request made before the commit window. */
  carried: boolean;
  steps: TurnStep[];
  outcome: string;
  decisions: { text: string; why: string }[];
  /** Prompt review: what to keep doing and what to add next time. */
  tips: { keep: string[]; improve: string[] };
  metrics: { start: string; end: string; aiSteps: number; files: number; reruns: number };
  sessionId: string;
}

/**
 * Commit Context: the shareable, reviewer-oriented summary of a commit's AI work.
 * Stored as a git note on refs/notes/promptlens and pushed alongside the branch.
 */
export interface CommitContext {
  version: 1;
  sha: string;
  subject: string;
  generatedBy: "claude-cli" | "openai" | "heuristic";
  intent: Claim;
  keyPrompts: KeyPrompt[];
  decisions: Claim[];
  aiWork: string[];
  verification: Claim[];
  files: { path: string; aiEdited: boolean }[];
  stats: { sessions: number; prompts: number; aiEdits: number };
  sessionIds: string[];
  /** Developer requests and what the agent did for each, in order (absent in notes written before v0.2). */
  turns?: Turn[];
}
