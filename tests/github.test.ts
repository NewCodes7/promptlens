import { afterEach, describe, expect, it, vi } from "vitest";
import { readPullRequestEvent, upsertComment, upsertFile } from "../src/github.js";
import { REPORT_MARKER } from "../src/report.js";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake api.github.com: each route answers one `METHOD /path` (query string included). */
function fakeGitHub(routes: Record<string, (body: unknown) => Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = input.replace("https://api.github.com", "");
    const method = init.method ?? "GET";
    const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, body });
    const route = routes[`${method} ${url}`];
    return route ? route(body) : new Response(`no route for ${method} ${url}`, { status: 599 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const comment = (id: number, body: string) => ({ id, html_url: `https://github.com/o/r/pull/1#issuecomment-${id}`, body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upsertComment", () => {
  it("creates the comment when the PR has no PromptLens comment yet", async () => {
    const calls = fakeGitHub({
      "GET /repos/o/r/issues/1/comments?per_page=100&page=1": () => json([comment(10, "LGTM")]),
      "POST /repos/o/r/issues/1/comments": () => json(comment(11, "report"), 201),
    });
    const res = await upsertComment("tkn", "o/r", 1, "report");
    expect(res).toEqual({ id: 11, action: "created", url: "https://github.com/o/r/pull/1#issuecomment-11" });
    expect(calls.at(-1)?.body).toEqual({ body: "report" });
  });

  it("updates its own comment in place instead of adding a second one", async () => {
    const calls = fakeGitHub({
      "GET /repos/o/r/issues/1/comments?per_page=100&page=1": () => json([comment(10, "LGTM"), comment(12, `${REPORT_MARKER}\nold`)]),
      "PATCH /repos/o/r/issues/comments/12": () => json(comment(12, "new")),
    });
    const res = await upsertComment("tkn", "o/r", 1, "new");
    expect(res.action).toBe("updated");
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
  });

  it("keeps paging until it finds its comment", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => comment(i + 1, "chatter"));
    const calls = fakeGitHub({
      "GET /repos/o/r/issues/1/comments?per_page=100&page=1": () => json(fullPage),
      "GET /repos/o/r/issues/1/comments?per_page=100&page=2": () => json([comment(500, `${REPORT_MARKER}\nold`)]),
      "PATCH /repos/o/r/issues/comments/500": () => json(comment(500, "new")),
    });
    expect((await upsertComment("tkn", "o/r", 1, "new")).id).toBe(500);
    expect(calls).toHaveLength(3);
  });

  it("sends the token and the API version on every request", async () => {
    const calls = fakeGitHub({
      "GET /repos/o/r/issues/1/comments?per_page=100&page=1": () => json([]),
      "POST /repos/o/r/issues/1/comments": () => json(comment(1, "x"), 201),
    });
    await upsertComment("tkn", "o/r", 1, "x");
    for (const c of calls) {
      expect(c.headers.authorization).toBe("Bearer tkn");
      expect(c.headers["x-github-api-version"]).toBe("2022-11-28");
      expect(c.headers["user-agent"]).toBe("promptlens");
    }
  });

  it("names the method, path and status when GitHub refuses", async () => {
    fakeGitHub({ "GET /repos/o/r/issues/1/comments?per_page=100&page=1": () => new Response("Bad credentials", { status: 401 }) });
    await expect(upsertComment("bad", "o/r", 1, "x")).rejects.toThrow(
      "GitHub GET /repos/o/r/issues/1/comments?per_page=100&page=1 → 401: Bad credentials",
    );
  });

  it("rejects a payload that is not a comment instead of posting blindly", async () => {
    fakeGitHub({ "GET /repos/o/r/issues/1/comments?per_page=100&page=1": () => json([{ id: "not-a-number" }]) });
    await expect(upsertComment("tkn", "o/r", 1, "x")).rejects.toThrow("unexpected GitHub comment payload");
  });
});

describe("upsertFile", () => {
  const getUrl = "GET /repos/o/r/contents/.promptlens/PR-7.md?ref=feat%2Fx";
  const putUrl = "PUT /repos/o/r/contents/.promptlens/PR-7.md";
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("creates the file when the branch doesn't have it", async () => {
    const calls = fakeGitHub({
      [getUrl]: () => new Response("Not Found", { status: 404 }),
      [putUrl]: () => json({ commit: { sha: "c0ffee1" } }, 201),
    });
    const res = await upsertFile("tkn", "o/r", "feat/x", ".promptlens/PR-7.md", "# flow\n", "msg");
    expect(res).toEqual({ action: "created", sha: "c0ffee1" });
    expect(calls.at(-1)?.body).toEqual({ message: "msg", content: b64("# flow\n"), branch: "feat/x" });
  });

  it("updates the file against the current blob sha when the content changed", async () => {
    const calls = fakeGitHub({
      [getUrl]: () => json({ sha: "blob1", content: b64("# old\n") }),
      [putUrl]: () => json({ commit: { sha: "c0ffee2" } }),
    });
    const res = await upsertFile("tkn", "o/r", "feat/x", ".promptlens/PR-7.md", "# new\n", "msg");
    expect(res).toEqual({ action: "updated", sha: "c0ffee2" });
    expect(calls.at(-1)?.body).toMatchObject({ sha: "blob1" });
  });

  it("skips the commit when the content is already identical", async () => {
    const calls = fakeGitHub({ [getUrl]: () => json({ sha: "blob1", content: b64("# same\n") }) });
    expect(await upsertFile("tkn", "o/r", "feat/x", ".promptlens/PR-7.md", "# same\n", "msg")).toEqual({ action: "unchanged" });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("surfaces errors other than 404 instead of overwriting the file", async () => {
    const calls = fakeGitHub({ [getUrl]: () => new Response("server error", { status: 500 }) });
    await expect(upsertFile("tkn", "o/r", "feat/x", ".promptlens/PR-7.md", "x", "msg")).rejects.toThrow("→ 500");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
});

describe("readPullRequestEvent", () => {
  it("leaves out fields with the wrong type", () => {
    expect(readPullRequestEvent({ pull_request: { number: "7", head: { sha: 1, ref: "feat" } } })).toEqual({
      number: undefined,
      baseSha: undefined,
      headSha: undefined,
      headRef: "feat",
      headRepo: undefined,
    });
  });
});
