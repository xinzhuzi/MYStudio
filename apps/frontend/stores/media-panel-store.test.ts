import { beforeEach, describe, expect, it } from "vitest";
import { mainNavItems, tabs, useMediaPanelStore } from "./media-panel-store";

describe("media panel navigation", () => {
  beforeEach(() => {
    useMediaPanelStore.setState({
      activeTab: "dashboard",
      activeStage: "script",
      inProject: false,
      activeEpisodeIndex: null,
      activeEpisodeScopeKey: null,
      navigationBackStack: [],
      navigationForwardStack: [],
    });
  });

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

  it("uses the chrome arrows as workspace history instead of a direct dashboard jump", () => {
    const store = useMediaPanelStore.getState();

    store.setActiveTab("overview");
    useMediaPanelStore.getState().setActiveTab("studio");
    useMediaPanelStore.getState().setActiveTab("assets");

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: "assets",
      inProject: true,
    });
    expect(useMediaPanelStore.getState().canGoBack()).toBe(true);
    expect(useMediaPanelStore.getState().canGoForward()).toBe(false);

    useMediaPanelStore.getState().goBack();

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: "studio",
      inProject: true,
    });
    expect(useMediaPanelStore.getState().canGoBack()).toBe(true);
    expect(useMediaPanelStore.getState().canGoForward()).toBe(true);

    useMediaPanelStore.getState().goForward();

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: "assets",
      inProject: true,
    });
  });
});
