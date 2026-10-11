// @vitest-environment jsdom
/**
 * 批2 设置页「成本估价」小节测试(10-11 pipeline-human-node-automation,G7/G16):
 * 估价表可调(provider:model→元/张)、单章上限可调、本地通道恒 ¥0 零计费展示、
 * 未绑定引导;云端AI 设置页第四节导航可达。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultFeatureBindings,
  useAPIConfigStore,
  type FeatureBindings,
  type IProvider,
} from "@/stores/ai/api-config-store";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import { ApiSettingsTab } from "./ApiSettingsTab";
import { CostEstimateSettingsSection } from "./CostEstimateSettingsSection";

const LOCAL_PROVIDER: IProvider = {
  id: "manying-local-image",
  name: "漫影本地生图",
  platform: "manying-local-image",
  baseUrl: "http://127.0.0.1:17595/v1",
  apiKey: "manying-local-image",
  model: ["qwen-image-2-1"],
};

const FANREN_PROVIDER: IProvider = {
  id: "fanren",
  name: "凡人",
  platform: "openai-compatible",
  baseUrl: "https://api.fanren.example/v1",
  apiKey: "sk-fanren-test",
  model: ["gpt-image-2"],
};

const PROVIDERS = [LOCAL_PROVIDER, FANREN_PROVIDER];

function seedBindings(bindings: Partial<FeatureBindings>) {
  useAPIConfigStore.setState({
    providers: PROVIDERS,
    featureBindings: { ...createDefaultFeatureBindings(), ...bindings },
  });
}

beforeEach(() => {
  useScriptAssetCostStore.setState({ prices: {}, chapterCapCny: 10 });
});

afterEach(cleanup);

describe("CostEstimateSettingsSection", () => {
  it("列出三生图功能的绑定通道:云端可填单价,本地恒 ¥0 零计费", () => {
    seedBindings({
      character_generation: ["manying-local-image:qwen-image-2-1"],
      prop_generation: ["fanren:gpt-image-2"],
    });
    render(<CostEstimateSettingsSection />);

    expect(screen.getByText("凡人")).toBeTruthy();
    expect(screen.getByText("gpt-image-2")).toBeTruthy();
    expect(screen.getByText("本地 · 零计费")).toBeTruthy();
    // 本地通道不出现单价输入(法定零价)
    expect(
      screen.queryByLabelText("漫影本地生图:qwen-image-2-1 单价（元/张）"),
    ).toBeNull();
    expect(screen.getByText("¥0")).toBeTruthy();
    // 云端通道单价输入在场,未填标注按 ¥0 计
    expect(screen.getByLabelText("凡人:gpt-image-2 单价（元/张）")).toBeTruthy();
    expect(screen.getByText("未估价（按 ¥0 计）")).toBeTruthy();
  });

  it("填单价/清空 → 估价表落库;单章上限可调", () => {
    seedBindings({ prop_generation: ["fanren:gpt-image-2"] });
    render(<CostEstimateSettingsSection />);

    const priceInput = screen.getByLabelText("凡人:gpt-image-2 单价（元/张）");
    fireEvent.change(priceInput, { target: { value: "4.5" } });
    expect(useScriptAssetCostStore.getState().prices["fanren:gpt-image-2"]).toBe(4.5);

    fireEvent.change(priceInput, { target: { value: "" } });
    expect(useScriptAssetCostStore.getState().prices["fanren:gpt-image-2"]).toBeUndefined();

    const capInput = screen.getByLabelText(/单章云端成本上限/);
    fireEvent.change(capInput, { target: { value: "25" } });
    expect(useScriptAssetCostStore.getState().chapterCapCny).toBe(25);
  });

  it("未绑定生图通道:给出到模型映射的引导,不空表误导", () => {
    seedBindings({});
    render(<CostEstimateSettingsSection />);
    expect(screen.getByText(/先到「模型映射」为角色\/场景\/道具生成绑定模型/)).toBeTruthy();
  });
});

describe("云端AI 设置页导航", () => {
  it("第四节「成本估价」可达", () => {
    seedBindings({});
    render(
      <ApiSettingsTab
        providers={PROVIDERS}
        configuredCount={2}
        syncingProviderId={null}
        testingProviderId={null}
        modelTestMessages={{}}
        onAdd={() => undefined}
        onDelete={() => undefined}
        onEdit={() => undefined}
        onSync={() => undefined}
        onTest={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /成本估价/ }));
    expect(screen.getByRole("heading", { name: "成本估价" })).toBeTruthy();
  });
});
