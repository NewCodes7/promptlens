import { describe, expect, it } from "vitest";
import { COMMANDS, suggestCommand, unknownCommand, usage } from "../src/usage.js";

describe("usage", () => {
  it("lists every command the CLI dispatches", () => {
    const text = usage();
    for (const cmd of COMMANDS) expect(text).toContain(`promptlens ${cmd}`);
    expect(text).toContain("promptlens --help");
  });
});

describe("unknown commands", () => {
  it.each([
    ["reprot", "report"],
    ["pr-reprot", "pr-report"],
    ["sumarize", "summarize"],
    ["INIT", "init"],
    ["--verison", "--version"],
  ])("suggests the closest command for %s", (typo, expected) => {
    expect(suggestCommand(typo)).toBe(expected);
  });

  it("gives no suggestion when nothing is close", () => {
    expect(suggestCommand("deploy")).toBeUndefined();
    expect(unknownCommand("deploy")).toBe("[promptlens] unknown command: deploy");
  });

  it("names the suggestion in the error line", () => {
    expect(unknownCommand("reprot")).toBe("[promptlens] unknown command: reprot (did you mean `promptlens report`?)");
  });
});
