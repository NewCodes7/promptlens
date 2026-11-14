import { errorMessage } from "./errors.js";
import { asArray, asObject, asString, type JsonObject } from "./json.js";
import { REPORT_MARKER } from "./report.js";

async function gh(token: string, method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "promptlens",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

export interface PullRequestEvent {
  number?: number;
  baseSha?: string;
  headSha?: string;
  headRef?: string;
  headRepo?: string;
}

/** The fields PromptLens needs from the GitHub Actions `pull_request` event payload, if there is one. */
export function readPullRequestEvent(json: unknown): PullRequestEvent {
  const pr = asObject(asObject(json).pull_request);
  const head = asObject(pr.head);
  return {
    number: typeof pr.number === "number" ? pr.number : undefined,
    baseSha: asString(asObject(pr.base).sha),
    headSha: asString(head.sha),
    headRef: asString(head.ref),
    headRepo: asString(asObject(head.repo).full_name),
  };
}

interface IssueComment {
  id: number;
  url: string;
  body: string;
}

/** Read an issue comment from the API, failing loudly if GitHub returns something else. */
function toComment(value: unknown): IssueComment {
  const c = asObject(value);
  if (typeof c.id !== "number" || typeof c.html_url !== "string") throw new Error("unexpected GitHub comment payload");
  return { id: c.id, url: c.html_url, body: asString(c.body) ?? "" };
}

/** Create the PromptLens comment on a PR, or update it in place so there is only ever one. */
export async function upsertComment(
  token: string,
  repo: string,
  pr: number,
  body: string,
): Promise<{ id: number; action: "created" | "updated"; url: string }> {
  for (let page = 1; page <= 20; page++) {
    const comments = asArray(await gh(token, "GET", `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`)).map(toComment);
    const mine = comments.find((c) => c.body.includes(REPORT_MARKER));
    if (mine) {
      const c = toComment(await gh(token, "PATCH", `/repos/${repo}/issues/comments/${mine.id}`, { body }));
      return { id: c.id, action: "updated", url: c.url };
    }
    if (comments.length < 100) break;
  }
  const c = toComment(await gh(token, "POST", `/repos/${repo}/issues/${pr}/comments`, { body }));
  return { id: c.id, action: "created", url: c.url };
}

/** The current blob of a file from the Contents API, or null if the response isn't a file. */
function toFile(value: unknown): { sha: string; content: string } | null {
  const f: JsonObject = asObject(value);
  const sha = asString(f.sha);
  const content = asString(f.content);
  return sha !== undefined && content !== undefined ? { sha, content } : null;
}

/**
 * Commit `content` to `path` on `branch` through the Contents API (no checkout or push needed).
 * Skips the commit when the file already has exactly this content, so line comments on it aren't made outdated.
 * GitHub holds runs on a GITHUB_TOKEN commit as "action required"; even when approved, the unchanged file
 * is not committed again, so this can't loop.
 */
export async function upsertFile(
  token: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<{ action: "created" | "updated" | "unchanged"; sha?: string }> {
  const url = `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  let existing: { sha: string; content: string } | null = null;
  try {
    existing = toFile(await gh(token, "GET", `${url}?ref=${encodeURIComponent(branch)}`));
  } catch (err) {
    if (!/→ 404:/.test(errorMessage(err))) throw err;
  }
  if (existing && Buffer.from(existing.content, "base64").toString("utf8") === content) return { action: "unchanged" };
  const res = await gh(token, "PUT", url, {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(existing ? { sha: existing.sha } : {}),
  });
  return { action: existing ? "updated" : "created", sha: asString(asObject(asObject(res).commit).sha) };
}
