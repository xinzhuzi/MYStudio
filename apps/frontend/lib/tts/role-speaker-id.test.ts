import { describe, expect, it } from "vitest";
import { toRoleSpeakerId } from "./role-speaker-id";

describe("toRoleSpeakerId", () => {
  it("normalizes role asset ids to TTS character speaker ids", () => {
    expect(toRoleSpeakerId("hero")).toBe("character:hero");
    expect(toRoleSpeakerId("character:hero")).toBe("character:hero");
  });
});
