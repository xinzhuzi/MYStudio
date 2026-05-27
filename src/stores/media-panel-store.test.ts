import { describe, expect, it } from "vitest";
import { mainNavItems, tabs, useMediaPanelStore } from "./media-panel-store";

describe("media panel navigation", () => {
  it("exposes skill editor as a standalone project workspace", () => {
    expect(mainNavItems.map((item) => item.id)).toContain("skills");
    expect(tabs.skills.label).toBe("技能");

    useMediaPanelStore.getState().setActiveTab("dashboard");
    useMediaPanelStore.getState().setActiveTab("skills");

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: "skills",
      inProject: true,
    });
  });

  it("exposes TTS as a standalone project workspace", () => {
    expect(mainNavItems.map((item) => item.id)).toContain("tts");
    expect(tabs.tts.label).toBe("TTS");

    useMediaPanelStore.getState().setActiveTab("dashboard");
    useMediaPanelStore.getState().setActiveTab("tts");

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: "tts",
      inProject: true,
    });
  });
});
