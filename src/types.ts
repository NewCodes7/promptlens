/** A single human prompt typed into an AI coding session. */
export interface PromptEvent {
  ts: string;
  text: string;
}

/** A file-modifying tool call made by the AI (Edit, Write, MultiEdit, ...). */
export interface EditEvent {
  ts: string;
  tool: string;
  /** Path relative to the repository root. */
  file: string;
}

/** A shell command run by the AI — used to detect verification (tests, builds). */
export interface CommandEvent {
  ts: string;
  command: string;
  description?: string;
}

/** A question the AI asked the developer and the answer it got. */
export interface DecisionEvent {
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

export interface KeyPrompt {
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

/**
 * Commit Context: the shareable, reviewer-oriented summary of a commit's AI work.
 * Stored as a git note on refs/notes/promptlens and pushed alongside the branch.
 */
export interface CommitContext {
  version: 1;
  sha: string;
  subject: string;
  generatedBy: "claude-cli" | "heuristic";
  intent: Claim;
  keyPrompts: KeyPrompt[];
  decisions: Claim[];
  aiWork: string[];
  verification: Claim[];
  files: { path: string; aiEdited: boolean }[];
  stats: { sessions: number; prompts: number; aiEdits: number };
  sessionIds: string[];
}
