import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultWorkflowRun, isEphemeralCli, workflowYaml } from "../src/init.js";
import { parsePackageInfo, pkg } from "../src/pkg.js";

describe("generated workflow", () => {
  it("pins the exact package version instead of @latest", () => {
    const run = defaultWorkflowRun({ name: "@scope/tool", version: "1.2.3" });
    expect(run).toBe("npx --yes @scope/tool@1.2.3 pr-report --post");
    expect(run).not.toContain("@latest");
  });

  it("defaults to the version that is running init", () => {
    expect(defaultWorkflowRun()).toBe(`npx --yes ${pkg.name}@${pkg.version} pr-report --post`);
  });

  it("puts the run command in the report step and keeps the needed permissions", () => {
    const yaml = workflowYaml("node dist/cli.js pr-report --post");
    expect(yaml).toContain("        run: node dist/cli.js pr-report --post\n");
    expect(yaml).toContain("contents: write");
    expect(yaml).toContain("pull-requests: write");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression, not a JS template
    expect(yaml).toContain("${{ secrets.GITHUB_TOKEN }}");
  });
});

describe("isEphemeralCli", () => {
  it("flags CLIs running from the npx cache", () => {
    expect(isEphemeralCli("/Users/me/.npm/_npx/3f2a/node_modules/@newcodes7/promptlens/dist/cli.js")).toBe(true);
    expect(isEphemeralCli("C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\3f2a\\node_modules\\x\\cli.js")).toBe(true);
  });

  it("accepts global and local installs", () => {
    expect(isEphemeralCli("/usr/local/lib/node_modules/@newcodes7/promptlens/dist/cli.js")).toBe(false);
    expect(isEphemeralCli("/repo/node_modules/@newcodes7/promptlens/dist/cli.js")).toBe(false);
  });
});

describe("parsePackageInfo", () => {
  it("reads this package's name and version", () => {
    const fromDisk = parsePackageInfo(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(fromDisk).toEqual(pkg);
    expect(pkg.name).toBe("@newcodes7/promptlens");
  });

  it("rejects package.json without a string name or version", () => {
    expect(() => parsePackageInfo('{"name":"x"}')).toThrow(/name or version/);
    expect(() => parsePackageInfo('{"name":1,"version":"1.0.0"}')).toThrow(/name or version/);
    expect(() => parsePackageInfo("null")).toThrow(/name or version/);
  });
});
