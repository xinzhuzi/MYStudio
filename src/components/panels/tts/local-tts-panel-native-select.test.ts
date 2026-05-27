import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LocalTtsPanel select controls", () => {
  it("does not mount Radix Select in the standalone TTS page", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("function NativeTtsSelect");
    expect(source).not.toContain("@/components/ui/select");
    expect(source).not.toContain("<Select ");
    expect(source).not.toContain("<SelectContent");
  });

  it("keeps Zustand selectors referentially stable", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("Object.values(state.voiceProfiles)");
    expect(source).toContain("Object.values(voiceProfilesById)");
  });
});
