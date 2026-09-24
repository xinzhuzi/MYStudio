// @vitest-environment jsdom

// Qwen21SpeedupSection 测试(09-24 迁移版):LoRA 态展示已迁模型库行内注释
// (comfy-models-taxonomy.test 覆盖),本文件只测 TE-Speed——纯函数状态机
// (台账判据/禁假绿)+ 生态插件区尾行渲染。组件吃 prop 控制器,直接传假
// 控制器对象,不 mock hook(照 ComfyEngineSettingsSection.test 口径)。

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  QWEN21_TE_SPEED_PLUGIN_ID,
  Qwen21TeSpeedPluginRow,
  deriveQwen21TeSpeedState,
} from "./Qwen21SpeedupSection";
import type { ComfyEngineSettingsController } from "./useComfyEngineSettings";
import type { ComfyPluginInfo } from "./comfy-engine-contract";

function plugin(overrides: Partial<ComfyPluginInfo> = {}): ComfyPluginInfo {
  return {
    id: QWEN21_TE_SPEED_PLUGIN_ID,
    name: "TE-Speed-QwenImage21",
    description: "",
    license: "",
    state: "installed",
    nodeCount: 4,
    deps: [],
    author: "",
    downloads: 0,
    category: "",
    ...overrides,
  } as ComfyPluginInfo;
}

function engine(plugins: ComfyPluginInfo[] | null, hasBridge = true): ComfyEngineSettingsController {
  return { hasBridge, plugins } as unknown as ComfyEngineSettingsController;
}

describe("deriveQwen21TeSpeedState(禁假绿状态机)", () => {
  it("台账未取到(null/空)= 检查中,不冒充未装", () => {
    expect(deriveQwen21TeSpeedState(null)).toBe("checking");
    expect(deriveQwen21TeSpeedState(undefined)).toBe("checking");
    expect(deriveQwen21TeSpeedState([])).toBe("checking");
  });

  it("台账无此插件 = 未装", () => {
    expect(deriveQwen21TeSpeedState([plugin({ id: "other-plugin" })])).toBe("missing");
  });

  it("在册且 nodeCount>0 = 已装(唯一亮绿路)", () => {
    expect(deriveQwen21TeSpeedState([plugin({ nodeCount: 4 })])).toBe("installed");
  });

  it("在册但节点零注册 = 不可用(MPS),不亮绿", () => {
    expect(deriveQwen21TeSpeedState([plugin({ nodeCount: 0 })])).toBe("unavailable");
    expect(deriveQwen21TeSpeedState([plugin({ nodeCount: null })])).toBe("unavailable");
  });

  it("安装失败态 = failed", () => {
    expect(deriveQwen21TeSpeedState([plugin({ state: "install-failed" })])).toBe("failed");
  });
});

describe("Qwen21TeSpeedPluginRow(生态插件区尾行)", () => {
  it("无桥(网页态)不渲染", () => {
    const { container } = render(<Qwen21TeSpeedPluginRow engine={engine(null, false)} />);
    expect(container.firstChild).toBeNull();
  });

  it("未装:行名+指引+灰胶囊", () => {
    render(<Qwen21TeSpeedPluginRow engine={engine([plugin({ id: "other" })])} />);
    expect(screen.getByText("采样提速插件(TE-Speed)")).toBeTruthy();
    expect(screen.getByText("还没装;装好且本机验证通过后才显示已装。")).toBeTruthy();
    expect(screen.getByText("未装")).toBeTruthy();
  });

  it("已装:绿胶囊且零提示行(成功态零统计提示纪律)", () => {
    const { container } = render(
      <Qwen21TeSpeedPluginRow engine={engine([plugin({ nodeCount: 4 })])} />,
    );
    expect(screen.getByText("已装")).toBeTruthy();
    expect(container.querySelector("[data-qwen21-te-hint]")).toBeNull();
  });

  it("不可用(MPS):如实胶囊不假绿", () => {
    render(<Qwen21TeSpeedPluginRow engine={engine([plugin({ nodeCount: 0 })])} />);
    expect(screen.getByText("不可用(MPS)")).toBeTruthy();
  });
});
