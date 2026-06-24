import { describe, expect, it } from "vitest";
import { isIsolatedSmokeUserDataDir } from "./workflow-smoke-bridge";

describe("workflow smoke bridge isolation", () => {
  it("allows only temp smoke user data directories", () => {
    expect(isIsolatedSmokeUserDataDir("/var/folders/tmp/mystudio-smoke-abcd")).toBe(true);
    expect(isIsolatedSmokeUserDataDir("/var/folders/tmp/mystudio-installed-smoke-abcd")).toBe(true);
  });

  it("blocks real MYStudio user data directories", () => {
    expect(isIsolatedSmokeUserDataDir("")).toBe(false);
    expect(isIsolatedSmokeUserDataDir("/Users/me/Library/Application Support/漫影工作室")).toBe(false);
    expect(isIsolatedSmokeUserDataDir("/Users/me/Library/Application Support/MYStudio")).toBe(false);
  });
});
