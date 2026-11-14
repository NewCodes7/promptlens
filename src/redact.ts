/**
 * Mask secrets and personal data before anything leaves the developer's machine.
 * Order matters: specific token formats first, then generic key=value patterns.
 */
const RULES: { name: string; re: RegExp; replace?: (m: string, ...g: string[]) => string }[] = [
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g },
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "bearer", re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, replace: (_m, b) => `${b} [REDACTED:bearer]` },
  {
    name: "assignment",
    re: /\b((?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)(["']?)([^\s"']{6,})\2/gi,
    // Only mask values that look like credentials (quoted, or containing digits/symbols),
    // so prose like "secret: handling" is left alone.
    replace: (m, prefix, quote, value) => (quote || /[\d_+/=-]/.test(value) ? `${prefix}[REDACTED:secret]` : m),
  },
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

export function redact(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (match: string, ...rest: unknown[]) => {
      if (!rule.replace) return `[REDACTED:${rule.name}]`;
      // Capture groups come first and keep their positions; an unmatched group or the offset becomes "".
      return rule.replace(match, ...rest.map((g) => (typeof g === "string" ? g : "")));
    });
  }
  return out;
}

export function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
