import { describe, expect, it } from "vitest";
import { redact, truncate } from "../src/redact.js";

describe("redact", () => {
  it.each([
    ["sk-ant-api03-abcdefghijklmnopqrstuv", "anthropic-key"],
    ["sk-proj-abcdefghijklmnopqrstuvwxyz123456", "openai-key"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github-token"],
    ["AKIAABCDEFGHIJKLMNOP", "aws-key"],
    ["xoxb-1234567890-abcdefghij", "slack-token"],
    ["dev@example.com", "email"],
  ])("masks %s", (secret, kind) => {
    const out = redact(`use ${secret} please`);
    expect(out).not.toContain(secret);
    expect(out).toContain(`[REDACTED:${kind}]`);
  });

  it("masks key=value secrets but keeps the key name", () => {
    expect(redact('API_KEY="hunter2hunter2"')).toBe("API_KEY=[REDACTED:secret]");
    expect(redact("password: s3cretpass")).toBe("password: [REDACTED:secret]");
  });

  it("masks bearer tokens and private keys", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop1234")).toContain("Bearer [REDACTED:bearer]");
    expect(redact("-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----")).toBe("[REDACTED:private-key]");
  });

  it("does not mask prose that merely follows a secret-like word", () => {
    const p = "uses the OPENAI_API_KEY secret: handling is documented";
    expect(redact(p)).toBe(p);
    expect(redact("token: abc123xyz")).toBe("token: [REDACTED:secret]");
  });

  it("leaves ordinary prompts alone", () => {
    const p = "Refactor the token bucket so tests pass";
    expect(redact(p)).toBe(p);
  });
});

describe("truncate", () => {
  it("trims and adds an ellipsis only when needed", () => {
    expect(truncate("  short  ", 10)).toBe("short");
    expect(truncate("abcdefghijkl", 5)).toBe("abcd…");
  });
});
