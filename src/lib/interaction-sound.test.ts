import { describe, expect, it } from "vitest";
import { resolveInteractionSoundIntent } from "./interaction-sound";

describe("resolveInteractionSoundIntent", () => {
  it("plays a primary tone for buttons and links", () => {
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON" })).toBe("primary");
    expect(resolveInteractionSoundIntent({ tagName: "A" })).toBe("primary");
  });

  it("uses a softer tone for toggles, tabs, and menu items", () => {
    expect(resolveInteractionSoundIntent({ tagName: "DIV", role: "tab" })).toBe("soft");
    expect(resolveInteractionSoundIntent({ tagName: "DIV", role: "menuitem" })).toBe("soft");
    expect(resolveInteractionSoundIntent({ tagName: "DIV", role: "switch" })).toBe("soft");
  });

  it("does not play for disabled controls or text-entry fields", () => {
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", disabled: true })).toBeNull();
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", ariaDisabled: "true" })).toBeNull();
    expect(resolveInteractionSoundIntent({ tagName: "INPUT", type: "text" })).toBeNull();
    expect(resolveInteractionSoundIntent({ tagName: "TEXTAREA" })).toBeNull();
  });

  it("allows explicit overrides from data attributes", () => {
    expect(resolveInteractionSoundIntent({ tagName: "DIV", sound: "off" })).toBeNull();
    expect(resolveInteractionSoundIntent({ tagName: "DIV", sound: "confirm" })).toBe("confirm");
  });
});
