import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local Codex assistant development server binding", () => {
  it("binds the standard development command to localhost", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.dev).toContain("--hostname localhost");
  });
});
