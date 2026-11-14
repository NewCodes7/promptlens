import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/errors.js";

describe("errorMessage", () => {
  it("reads the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else that was thrown instead of printing undefined", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
