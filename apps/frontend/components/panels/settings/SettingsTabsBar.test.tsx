// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { SETTINGS_TABS, SettingsTabsBar } from "./SettingsTabsBar";

afterEach(cleanup);

describe("SettingsTabsBar", () => {
  it("keeps all established tabs and shows the image-host status marker only when configured", () => {
    const { rerender } = render(
      <Tabs>
        <SettingsTabsBar isImageHostConfigured />
      </Tabs>,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(SETTINGS_TABS.length);
    expect(screen.getByRole("tab", { name: "图床配置" }).querySelector(".bg-green-500")).toBeTruthy();

    rerender(
      <Tabs>
        <SettingsTabsBar isImageHostConfigured={false} />
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: "图床配置" }).querySelector(".bg-green-500")).toBeNull();
  });
});
