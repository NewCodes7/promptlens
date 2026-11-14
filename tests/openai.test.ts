import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiJson, synthesize } from "../src/openai.js";
import { type CommitEntry, templateSynthesis } from "../src/report.js";
import { heuristicContext } from "../src/summarize.js";
import type { RawCapture } from "../src/types.js";

const raw: RawCapture = {
  version: 1,
  sha: "abc1234def",
  subject: "feat: greet",
  window: { from: null, to: "2026-11-09T02:00:00Z" },
  filesChanged: ["src/greet.ts"],
  sessions: [
    {
      sessionId: "s1",
      agent: "claude-code",
      prompts: [{ ts: "2026-11-09T01:00:00Z", text: "Add a greet helper" }],
      edits: [{ ts: "2026-11-09T01:01:00Z", tool: "Edit", file: "src/greet.ts" }],
      commands: [],
      decisions: [],
      assistantNotes: [],
    },
  ],
};
const entries: CommitEntry[] = [{ sha: raw.sha, subject: raw.subject, context: heuristicContext(raw) }];

/** A Chat Completions response whose message content is `content`. */
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL"]) delete process.env[k];
});

describe("openaiJson", () => {
  it("refuses to call the API without a key", async () => {
    await expect(openaiJson("hi")).rejects.toThrow("OPENAI_API_KEY is not set");
  });

  it("sends a JSON-mode request to the configured endpoint and model", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_BASE_URL = "https://llm.example/v1/";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    expect(await openaiJson("hello")).toEqual({ ok: true });
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("reports the HTTP status of a failed call", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    await expect(openaiJson("hi")).rejects.toThrow("OpenAI 429: rate limited");
  });

  it("reads a response with no message as an empty object", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [] }))),
    );
    expect(await openaiJson("hi")).toEqual({});
  });

  it("rejects message content that is not a JSON object", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completion("[1, 2]")),
    );
    await expect(openaiJson("hi")).rejects.toThrow("expected a JSON object");
  });
});

describe("synthesize", () => {
  it("uses the template without a key, and never calls the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await synthesize(entries, "")).toEqual(templateSynthesis(entries));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the template when no commit has AI context", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bare: CommitEntry[] = [{ sha: "x", subject: "manual", context: null }];
    expect(await synthesize(bare, "")).toEqual(templateSynthesis(bare));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes the overview from the model and labels who wrote it", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completion(JSON.stringify({ overview: "Adds greet()", why: ["asked for it"], requests: [{ index: 0, outcome: "done" }] })),
      ),
    );
    const s = await synthesize(entries, " src/greet.ts | 3 +++");
    expect(s.overview).toBe("Adds greet()");
    expect(s.why).toEqual(["asked for it"]);
    expect(s.turnOutcomes?.[0]).toBe("done");
    expect(s.generatedBy).toBe("OpenAI gpt-5-mini");
  });

  it("falls back to the template and says why when the API fails", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await synthesize(entries, "")).toEqual(templateSynthesis(entries));
    expect(String(stderr.mock.calls[0]?.[0])).toContain("OpenAI synthesis failed, using template: OpenAI 503");
  });
});
