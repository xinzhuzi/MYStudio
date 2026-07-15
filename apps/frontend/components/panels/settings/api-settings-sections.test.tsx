// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IProvider } from "@/stores/api-config-store";
import { ApiServiceSettingsSection } from "./ApiServiceSettingsSection";
import { ApiSettingsTab } from "./ApiSettingsTab";

const provider: IProvider = {
  id: "provider-1",
  name: "测试供应商",
  platform: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: ["gpt-5.4", "gpt-image-2"],
};

afterEach(cleanup);

describe("API settings sections", () => {
  it("filters service models and delegates model tests", () => {
    const onTest = vi.fn();
    render(
      <ApiServiceSettingsSection
        provider={provider}
        syncingProviderId={null}
        testingProviderId={null}
        modelTestMessages={{}}
        onEdit={vi.fn()}
        onSync={vi.fn()}
        onTest={onTest}
      />,
    );

    fireEvent.change(screen.getByLabelText("搜索模型名称"), { target: { value: "image" } });
    expect(screen.getByText("gpt-image-2")).toBeTruthy();
    expect(screen.queryByText("gpt-5.4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(onTest).toHaveBeenCalledWith(provider, "gpt-image-2");
  });

  it("navigates between service, mapping, and Agent sections", () => {
    render(
      <ApiSettingsTab
        providers={[provider]}
        configuredCount={1}
        syncingProviderId={null}
        testingProviderId={null}
        modelTestMessages={{}}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onSync={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "供应商配置" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /模型映射/ }));
    expect(screen.getByRole("heading", { name: "服务映射" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Agent 配置/ }));
    expect(screen.getByRole("heading", { name: "Agent 配置" })).toBeTruthy();
  });
});
