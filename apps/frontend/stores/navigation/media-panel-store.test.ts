import { beforeEach, describe, expect, it } from "vitest";
import { mainNavItems, tabs } from "@/components/nav-config";
import { useMediaPanelStore, type Stage, type Tab } from "./media-panel-store";

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

  it("keeps the stage of every tab that belongs to one", () => {
    const expectations: Array<[Tab, Stage]> = [
      ["script", "script"],
      ["characters", "assets"],
      ["scenes", "assets"],
      ["director", "director"],
      ["sclass", "director"],
      ["export", "export"],
    ];
    for (const resetStage of ["script", "export"] as const) {
      for (const [tab, stage] of expectations) {
        useMediaPanelStore.setState({
          activeTab: "dashboard",
          activeStage: resetStage,
          inProject: false,
          activeEpisodeIndex: null,
          activeEpisodeScopeKey: null,
          navigationBackStack: [],
          navigationForwardStack: [],
        });
        useMediaPanelStore.getState().setActiveTab(tab);
        expect(useMediaPanelStore.getState()).toMatchObject({
          activeTab: tab,
          activeStage: stage,
          inProject: true,
        });
      }
    }
  });

  it("lands on the first tab of a stage when the stage is switched", () => {
    const expectations: Array<[Stage, Tab]> = [
      ["script", "script"],
      ["assets", "characters"],
      ["director", "director"],
      ["export", "export"],
    ];
    for (const [stage, tab] of expectations) {
      useMediaPanelStore.setState({
        activeTab: "dashboard",
        activeStage: "script",
        inProject: false,
        activeEpisodeIndex: null,
        activeEpisodeScopeKey: null,
        navigationBackStack: [],
        navigationForwardStack: [],
      });
      useMediaPanelStore.getState().setActiveStage(stage);
      expect(useMediaPanelStore.getState()).toMatchObject({
        activeStage: stage,
        activeTab: tab,
        inProject: true,
      });
    }
  });
});
