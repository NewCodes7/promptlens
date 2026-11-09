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
export async function upsertComment(token: string, repo: string, pr: number, body: string): Promise<{ id: number; action: "created" | "updated"; url: string }> {
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
