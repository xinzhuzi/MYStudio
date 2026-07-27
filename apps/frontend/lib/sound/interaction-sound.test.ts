import { describe, expect, it } from "vitest";
import { INTENT_TO_EFFECT, resolveInteractionSoundIntent } from "./interaction-sound";

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
    expect(resolveInteractionSoundIntent({ tagName: "DIV", sound: "cancel" })).toBe("cancel");
  });

  it("sinks dismiss-labelled buttons to the cancel voice", () => {
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", ariaLabel: "关闭面板" })).toBe("cancel");
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", ariaLabel: "取消" })).toBe("cancel");
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", ariaLabel: "删除分镜" })).toBe("cancel");
  });

  it("does not sink soft controls or plain buttons", () => {
    expect(resolveInteractionSoundIntent({ tagName: "DIV", role: "tab", ariaLabel: "关闭" })).toBe("soft");
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", ariaLabel: "开始生成" })).toBe("primary");
    expect(resolveInteractionSoundIntent({ tagName: "BUTTON", ariaLabel: "关闭", disabled: true })).toBeNull();
  });
});

describe("INTENT_TO_EFFECT", () => {
  it("maps every intent onto exactly one synthesized voice", () => {
    expect(INTENT_TO_EFFECT).toEqual({
      primary: "activate",
      soft: "click",
      confirm: "success",
      cancel: "cancel",
    });
  });
});
