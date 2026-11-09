/** Build Claude Code-style .jsonl lines for tests. */
export const ROOT = "/work/app";

let n = 0;
const base = (sessionId: string, ts: string) => ({ sessionId, timestamp: ts, cwd: ROOT, uuid: `u${n++}` });

export const userPrompt = (sessionId: string, ts: string, text: string, extra: object = {}) =>
  JSON.stringify({ ...base(sessionId, ts), type: "user", message: { role: "user", content: text }, ...extra });

export const toolUse = (sessionId: string, ts: string, name: string, input: object, id = `t${n++}`) =>
  JSON.stringify({
    ...base(sessionId, ts),
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  });

export const toolResult = (sessionId: string, ts: string, toolUseId: string, content: string) =>
  JSON.stringify({
    ...base(sessionId, ts),
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  });

export const assistantText = (sessionId: string, ts: string, text: string) =>
  JSON.stringify({ ...base(sessionId, ts), type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
