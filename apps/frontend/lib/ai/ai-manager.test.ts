import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { aiManager, resolve } from "./ai-manager";

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

  it("通过 aiManager 暴露功能配置查询，避免业务层直接依赖 feature-router", () => {
    useAPIConfigStore.setState({ featureBindings: { character_generation: ["p1:m1"] } } as never);
    const cfg = aiManager.featureConfig("character_generation");
    expect(cfg?.provider.id).toBe("p1");
    expect(cfg?.model).toBe("m1");
  });

  it("剧本面板通过 aiManager 查询功能配置，不直连 feature-router", () => {
    const source = readFileSync(join(process.cwd(), "frontend/components/panels/script/index.tsx"), "utf8");
    expect(source).toContain("@/lib/ai/ai-manager");
    expect(source).not.toMatch(/from\s+["']@\/lib\/ai\/feature-router["']/);
  });

  it("视频生成实现下沉到 lib/ai，aiManager 不静态依赖组件 hook", () => {
    const hookSource = readFileSync(join(process.cwd(), "frontend/components/panels/director/use-video-generation.ts"), "utf8");
    const managerSource = readFileSync(join(process.cwd(), "frontend/lib/ai/ai-manager.ts"), "utf8");
    expect(hookSource).toContain("@/lib/ai/video-generator");
    expect(hookSource).not.toMatch(/from\s+["']@\/lib\/ai\/feature-router["']/);
    expect(managerSource).toContain("@/lib/ai/video-generator");
    expect(managerSource).not.toContain("@/components/panels/director/use-video-generation");
  });
});
