// @vitest-environment jsdom
/**
 * 批2 成本护栏纯逻辑测试(10-11 pipeline-human-node-automation,G7/G16):
 * fail-closed 发车门(累计+本张>上限→不发;免费通道恒放行)、
 * 渠道估价解析(首绑通道/本地零计费/未估价云端 ¥0+priced=false)。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultFeatureBindings,
  useAPIConfigStore,
  type FeatureBindings,
  type IProvider,
} from "@/stores/ai/api-config-store";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import {
  channelEstimateLabel,
  costGuardAllowsDispatch,
  estimateImageChannel,
  formatCny,
  isLocalImageChannel,
} from "@/lib/studio/script-asset-cost";

const LOCAL_PROVIDER: IProvider = {
  id: "manying-local-image",
  name: "漫影本地生图",
  platform: "manying-local-image",
  baseUrl: "http://127.0.0.1:17595/v1",
  apiKey: "manying-local-image",
  model: ["qwen-image-2-1"],
};

const CLOUD_PROVIDER: IProvider = {
  id: "fanren",
  name: "凡人",
  platform: "openai-compatible",
  baseUrl: "https://api.fanren.example/v1",
  apiKey: "sk-fanren-test",
  model: ["gpt-image-2"],
};

function seedProviders(providers: IProvider[], bindings: Partial<FeatureBindings>) {
  // 全量重建(默认空+本用例覆盖):用例间的绑定残留会互相污染估价解析
  useAPIConfigStore.setState({
    providers,
    featureBindings: { ...createDefaultFeatureBindings(), ...bindings },
  });
}

beforeEach(() => {
  seedProviders([], {});
  useScriptAssetCostStore.setState({
    prices: {},
    chapterCapCny: useScriptAssetCostStore.getState().chapterCapCny,
  });
});

describe("costGuardAllowsDispatch(fail-closed 发车门)", () => {
  it("免费通道(本地/¥0)恒放行,包括累计已超上限时", () => {
    expect(costGuardAllowsDispatch(99, 0, 10)).toBe(true);
    expect(costGuardAllowsDispatch(0, 0, 0)).toBe(true);
  });

  it("累计+本张≤上限放行;>上限拦下(未发车不发)", () => {
    expect(costGuardAllowsDispatch(6, 4, 10)).toBe(true);
    expect(costGuardAllowsDispatch(6.01, 4, 10)).toBe(false);
    expect(costGuardAllowsDispatch(0, 11, 10)).toBe(false);
  });

  it("上限 0=只允许免费通道(付费张全拦)", () => {
    expect(costGuardAllowsDispatch(0, 0.01, 0)).toBe(false);
    expect(costGuardAllowsDispatch(0, 0, 0)).toBe(true);
  });

  it("浮点容差:6+4=10 不被二进制误差误拦", () => {
    expect(costGuardAllowsDispatch(0.1 + 0.2, 9.7, 10)).toBe(true);
  });
});

describe("estimateImageChannel(渠道估价解析)", () => {
  it("首绑通道命中估价表:priced=true 带单价", () => {
    seedProviders([CLOUD_PROVIDER], { prop_generation: ["fanren:gpt-image-2"] });
    useScriptAssetCostStore.setState({ prices: { "fanren:gpt-image-2": 4 } });

    const estimate = estimateImageChannel(
      "prop_generation",
      useScriptAssetCostStore.getState().prices,
    );
    expect(estimate).toMatchObject({
      key: "fanren:gpt-image-2",
      providerId: "fanren",
      providerLabel: "凡人",
      model: "gpt-image-2",
      isLocal: false,
      priceCny: 4,
      priced: true,
    });
  });

  it("纯本地通道恒 ¥0 且不算未估价(法定零价)", () => {
    seedProviders([LOCAL_PROVIDER], { prop_generation: ["manying-local-image:qwen-image-2-1"] });

    const estimate = estimateImageChannel(
      "prop_generation",
      useScriptAssetCostStore.getState().prices,
    );
    expect(estimate).toMatchObject({
      isLocal: true,
      priceCny: 0,
      priced: true,
    });
    expect(channelEstimateLabel(estimate!)).toBe("本地:qwen-image-2-1");
  });

  it("云端通道未配置单价:按 ¥0 计且 priced=false(报表标注未估价,不编造单价)", () => {
    seedProviders([CLOUD_PROVIDER], { prop_generation: ["fanren:gpt-image-2"] });

    const estimate = estimateImageChannel(
      "prop_generation",
      useScriptAssetCostStore.getState().prices,
    );
    expect(estimate).toMatchObject({ priceCny: 0, priced: false, isLocal: false });
  });

  it("功能未绑定通道:返回 null(发车前可见,不静默)", () => {
    seedProviders([CLOUD_PROVIDER], {});
    expect(
      estimateImageChannel("prop_generation", useScriptAssetCostStore.getState().prices),
    ).toBeNull();
  });

  it("多绑定时取首绑(优先通道),不动 feature-router 轮询游标", () => {
    seedProviders([LOCAL_PROVIDER, CLOUD_PROVIDER], {
      prop_generation: ["manying-local-image:qwen-image-2-1", "fanren:gpt-image-2"],
    });
    const estimate = estimateImageChannel(
      "prop_generation",
      useScriptAssetCostStore.getState().prices,
    );
    expect(estimate?.key).toBe("manying-local-image:qwen-image-2-1");
  });
});

describe("本地通道判定与金额展示", () => {
  it("isLocalImageChannel 认 id 与 platform 双口径", () => {
    expect(isLocalImageChannel("manying-local-image")).toBe(true);
    expect(isLocalImageChannel("other", "manying-local-image")).toBe(true);
    expect(isLocalImageChannel("fanren", "openai-compatible")).toBe(false);
  });

  it("formatCny 两位小数", () => {
    expect(formatCny(10)).toBe("¥10.00");
    expect(formatCny(0.1 + 0.2)).toBe("¥0.30");
  });
});
