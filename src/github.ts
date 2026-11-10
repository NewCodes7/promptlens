import { REPORT_MARKER } from "./report.js";

async function gh(token: string, method: string, url: string, body?: unknown): Promise<any> {
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

/** Create the PromptLens comment on a PR, or update it in place so there is only ever one. */
export async function upsertComment(
  token: string,
  repo: string,
  pr: number,
  body: string,
): Promise<{ id: number; action: "created" | "updated"; url: string }> {
  for (let page = 1; page <= 20; page++) {
    const comments: any[] = await gh(token, "GET", `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
    const mine = comments.find((c) => typeof c.body === "string" && c.body.includes(REPORT_MARKER));
    if (mine) {
      const c = await gh(token, "PATCH", `/repos/${repo}/issues/comments/${mine.id}`, { body });
      return { id: c.id, action: "updated", url: c.html_url };
    }
    if (comments.length < 100) break;
  }
  const c = await gh(token, "POST", `/repos/${repo}/issues/${pr}/comments`, { body });
  return { id: c.id, action: "created", url: c.html_url };
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
    existing = await gh(token, "GET", `${url}?ref=${encodeURIComponent(branch)}`);
  } catch (err) {
    if (!/→ 404:/.test((err as Error).message)) throw err;
  }
  if (existing && Buffer.from(existing.content, "base64").toString("utf8") === content) return { action: "unchanged" };
  const res = await gh(token, "PUT", url, {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(existing ? { sha: existing.sha } : {}),
  });
  return { action: existing ? "updated" : "created", sha: res?.commit?.sha };
}
