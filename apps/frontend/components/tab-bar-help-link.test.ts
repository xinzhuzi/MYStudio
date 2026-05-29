import { describe, expect, it } from "vitest";
import { HELP_REPOSITORY_URL } from "./TabBar";

describe("TabBar help link", () => {
  it("points to the public MYStudio repository", () => {
    expect(HELP_REPOSITORY_URL).toBe("https://github.com/xinzhuzi/MYStudio");
  });
});
