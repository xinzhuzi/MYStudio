import { describe, it, expect, beforeEach } from "vitest";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { resolve } from "./ai-manager";

const provider = {
  id: "p1",
  platform: "openai-compatible",
  name: "P1",
  baseUrl: "https://x/v1",
  apiKey: "k",
  model: ["m1"],
  apiProtocol: "openai-compatible",
};

beforeEach(() => {
  useAPIConfigStore.setState({
    providers: [provider],
    featureBindings: {},
    agentUseMode: "advanced",
    agentDeployments: [],
  } as never);
});

describe("aiManager.resolve", () => {
  it("Agent 绑定解析为 provider/model + 温度/maxTokens", () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "scriptDraft", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const r = resolve({ agent: "scriptDraft" });
    expect(r?.provider.id).toBe("p1");
    expect(r?.model).toBe("m1");
    expect(r?.temperature).toBe(0.7);
    expect(r?.maxTokens).toBe(1234);
  });

  it("Feature 绑定解析 vendorId:model", () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const r = resolve({ feature: "chat" });
    expect(r?.provider.id).toBe("p1");
    expect(r?.model).toBe("m1");
  });

  it("无绑定返回 null", () => {
    expect(resolve({ agent: "scriptDraft" })).toBeNull();
    expect(resolve({ feature: "chat" })).toBeNull();
  });
});
