import { describe, expect, it } from "vitest";
import { resolveInteractionSoundIntent as fromFacade } from "./interaction-sound";
import { resolveInteractionSoundIntent as fromCanonical } from "./sound/interaction-sound";

describe("interaction-sound root facade", () => {
  it("exports the same resolveInteractionSoundIntent implementation", () => {
    expect(fromFacade).toBe(fromCanonical);
  });
});
